'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const ops = require('./operations');
const conversation = require('./conversation');

const BRIDGE_VERSION = '0.6.0';
const PORT = Number(process.env.PORT || 8080);
const WAHA_BASE_URL = String(process.env.WAHA_BASE_URL || 'http://waha:3000').replace(/\/$/, '');
const WAHA_API_KEY = String(process.env.WAHA_API_KEY || '');
const WAHA_SESSION = String(process.env.WAHA_SESSION || 'homeeasy');
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || '');
const MAX_BODY_MB = Math.max(2, Number(process.env.MAX_BODY_MB || 18));
const MAX_BODY_BYTES = MAX_BODY_MB * 1024 * 1024;
const REMOTE_PDF_MAX_BYTES = Math.min(MAX_BODY_BYTES, 18 * 1024 * 1024);
const DATA_DIR = String(process.env.DATA_DIR || '/app/data');
const IDEMPOTENCY_FILE = path.join(DATA_DIR, 'idempotency.json');
const AMBIGUOUS_LOCK_MS = 15 * 60 * 1000;
const DOCUMENT_PERMISSIONS = Object.freeze({
  cotizacion: 'cotizaciones.write',
  pedido: 'pedidos.write',
  abono: 'abonos.write'
});

if (!WAHA_API_KEY || !BRIDGE_TOKEN) {
  console.error('Missing WAHA_API_KEY or BRIDGE_TOKEN. Refusing to start.');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function wahaRequest(method, route, body, accept = 'application/json') {
  const response = await fetch(`${WAHA_BASE_URL}${route}`, {
    method,
    headers: {
      'X-Api-Key': WAHA_API_KEY,
      'Accept': accept,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000)
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => ({}));
  } else {
    data = await response.text().catch(() => '');
  }

  if (!response.ok) {
    const error = new Error(`WAHA ${response.status}`);
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function getSession() {
  try {
    return await wahaRequest('GET', `/api/sessions/${encodeURIComponent(WAHA_SESSION)}`);
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

function publicSession(session) {
  if (!session) return { exists: false, name: WAHA_SESSION, status: 'MISSING', ready: false, me: null };
  return {
    exists: true,
    name: session.name || WAHA_SESSION,
    status: session.status || 'UNKNOWN',
    ready: session.status === 'WORKING',
    engine: session.engine && (session.engine.engine || session.engine),
    me: session.me || null
  };
}

async function ensureSessionStarted() {
  let session = await getSession();
  if (!session) {
    session = await wahaRequest('POST', '/api/sessions', {
      name: WAHA_SESSION,
      start: true,
      config: { webjs: { tagsEventsOn: false } }
    });
    return session;
  }
  if (session.status === 'STOPPED' || session.status === 'FAILED') {
    return await wahaRequest('POST', `/api/sessions/${encodeURIComponent(WAHA_SESSION)}/start`, {});
  }
  return session;
}

function normalizePhone(value) {
  let digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^3\d{9}$/.test(digits)) digits = `57${digits}`;
  if (!/^\d{8,15}$/.test(digits)) throw Object.assign(new Error('Invalid WhatsApp phone number'), { statusCode: 400 });
  return digits;
}

function cleanPdfBase64(value) {
  const raw = String(value || '').trim().replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw Object.assign(new Error('Invalid PDF base64'), { statusCode: 400 });
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw Object.assign(new Error('The attachment is not a valid PDF'), { statusCode: 400 });
  }
  return raw;
}

function safeFilename(value) {
  const cleaned = String(value || 'HomeEasy.pdf')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .trim();
  const name = cleaned || 'HomeEasy.pdf';
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

function trustedRemotePdfHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'drive.google.com' ||
    host === 'docs.google.com' ||
    host === 'drive.usercontent.google.com' ||
    host.endsWith('.googleusercontent.com');
}

function driveFileId(url) {
  const pathMatch = String(url.pathname || '').match(/\/file\/d\/([A-Za-z0-9_-]{10,})/i);
  if (pathMatch) return pathMatch[1];
  const id = String(url.searchParams.get('id') || '').trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : '';
}

function normalizeRemotePdfUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (_) {
    throw Object.assign(new Error('Invalid stored PDF URL'), { statusCode: 400 });
  }
  if (parsed.protocol !== 'https:' || !trustedRemotePdfHost(parsed.hostname)) {
    throw Object.assign(new Error('Stored PDF host is not allowed'), { statusCode: 400 });
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const fileId = driveFileId(parsed);
    if (!fileId) throw Object.assign(new Error('Google Drive PDF link is not supported'), { statusCode: 400 });
    return new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`);
  }
  return parsed;
}

async function readRemoteBody(response) {
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > REMOTE_PDF_MAX_BYTES) throw Object.assign(new Error('Stored PDF is too large'), { statusCode: 413 });
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw Object.assign(new Error('Stored PDF response could not be read'), { statusCode: 502 });
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      size += value.length;
      if (size > REMOTE_PDF_MAX_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        throw Object.assign(new Error('Stored PDF is too large'), { statusCode: 413 });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
  return Buffer.concat(chunks);
}

async function fetchStoredPdfBase64(value) {
  const target = normalizeRemotePdfUrl(value);
  let response;
  try {
    response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.2',
        'User-Agent': 'HomeEasy-WhatsApp-Bridge/0.5'
      },
      signal: AbortSignal.timeout(35000)
    });
  } catch (_) {
    throw Object.assign(new Error('Stored PDF could not be downloaded'), { statusCode: 502 });
  }

  if (!response.ok) throw Object.assign(new Error('Stored PDF could not be downloaded'), { statusCode: 502 });

  let finalUrl;
  try { finalUrl = new URL(response.url); } catch (_) { finalUrl = target; }
  if (!trustedRemotePdfHost(finalUrl.hostname)) {
    throw Object.assign(new Error('Stored PDF redirected to an untrusted host'), { statusCode: 502 });
  }

  const bytes = await readRemoteBody(response);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw Object.assign(new Error('Stored file is not an accessible PDF'), { statusCode: 422 });
  }
  return bytes.toString('base64');
}

function loadIdempotency() {
  try {
    const parsed = JSON.parse(fs.readFileSync(IDEMPOTENCY_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

let idempotency = loadIdempotency();

function persistIdempotency() {
  const entries = Object.entries(idempotency);
  if (entries.length > 1000) idempotency = Object.fromEntries(entries.slice(-1000));
  const temp = `${IDEMPOTENCY_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(idempotency, null, 2));
  fs.renameSync(temp, IDEMPOTENCY_FILE);
}

function isAmbiguousSendError(error) {
  const code = Number(error && error.statusCode || 0);
  return code >= 500 || error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function publicDeliveryRecord(record, duplicate) {
  return {
    ok: record.state === 'SENT',
    accepted: record.state === 'SENT' || record.state === 'UNKNOWN' || record.state === 'SENDING',
    duplicate: Boolean(duplicate),
    delivery: record.state,
    phone: record.phone,
    filename: record.filename,
    messageId: record.messageId || null,
    sentAt: record.sentAt || null,
    startedAt: record.startedAt || null,
    note: record.state === 'UNKNOWN'
      ? 'WAHA returned an ambiguous error after the send attempt. HomeEasy will not resend automatically to avoid duplicates.'
      : undefined
  };
}

function actorCan(actor, permission) {
  if (!permission || actor && actor.internal) return true;
  const permissions = actor && Array.isArray(actor.permissions) ? actor.permissions : [];
  return permissions.includes('*') || permissions.includes(permission);
}

function capabilities(actor) {
  return {
    configure: actorCan(actor, 'config.read'),
    sendCotizacion: actorCan(actor, 'cotizaciones.write'),
    sendPedido: actorCan(actor, 'pedidos.write'),
    sendAbono: actorCan(actor, 'abonos.write')
  };
}

function auditActor(actor) {
  const visible = auth.publicActor(actor);
  return visible && !visible.internal
    ? String(visible.nombre || visible.email || visible.rol || '').trim()
    : 'Sistema';
}

function activityMeta(payload, actor, documentType, kind, state, record, error) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    kind: kind || 'document',
    state,
    documentType: documentType || String(source.documentType || '').toLowerCase(),
    reference: source.reference || '',
    clientName: source.clientName || '',
    phone: record && record.phone || source.phone || '',
    filename: record && record.filename || source.filename || '',
    source: source.source || '',
    resend: Boolean(source.resend),
    actor: auditActor(actor),
    messageId: record && record.messageId || '',
    error: error ? String(error.message || error) : ''
  };
}

function recordActivitySafe(payload) {
  try { return ops.recordActivity(payload); } catch (error) {
    console.warn(new Date().toISOString(), 'Could not persist WhatsApp activity', error.message);
    return null;
  }
}

async function sendText(phoneValue, textValue, audit) {
  const session = await getSession();
  if (!session || session.status !== 'WORKING') {
    const error = new Error(`WhatsApp is not ready (${session ? session.status : 'MISSING'})`);
    error.statusCode = 503;
    error.details = publicSession(session);
    if (audit) recordActivitySafe(activityMeta(audit.payload || {}, audit.actor, 'prueba', 'test', 'FAILED', null, error));
    throw error;
  }

  let phone = String(phoneValue || '').trim();
  if (!phone && session.me && session.me.id) phone = String(session.me.id).replace(/@c\.us$/i, '');
  phone = normalizePhone(phone);
  const text = String(textValue || 'Prueba HomeEasy ✅ Integración de WhatsApp operativa.').trim().slice(0, 1200);

  try {
    const result = await wahaRequest('POST', '/api/sendText', {
      session: WAHA_SESSION,
      chatId: `${phone}@c.us`,
      text
    });
    const record = {
      state: 'SENT',
      phone,
      filename: '',
      messageId: result && (result.id || result.key || result.messageId) || null,
      sentAt: new Date().toISOString()
    };
    if (audit) recordActivitySafe(activityMeta(audit.payload || {}, audit.actor, 'prueba', 'test', 'SENT', record));
    return { ok: true, phone, messageId: record.messageId, sentAt: record.sentAt };
  } catch (error) {
    if (audit) recordActivitySafe(activityMeta(audit.payload || {}, audit.actor, 'prueba', 'test', 'FAILED', { phone }, error));
    throw error;
  }
}

async function sendDocument(payload, audit) {
  const session = await getSession();
  if (!session || session.status !== 'WORKING') {
    const error = new Error(`WhatsApp is not ready (${session ? session.status : 'MISSING'})`);
    error.statusCode = 503;
    error.details = publicSession(session);
    if (audit) recordActivitySafe(activityMeta(payload, audit.actor, audit.documentType, audit.kind, 'FAILED', null, error));
    throw error;
  }

  const phone = normalizePhone(payload.phone);
  const pdfBase64 = cleanPdfBase64(payload.pdfBase64);
  const filename = safeFilename(payload.filename);
  const caption = String(payload.caption || '').trim().slice(0, 1000);
  const idempotencyKey = String(payload.idempotencyKey || '').trim().slice(0, 180);

  if (idempotencyKey && idempotency[idempotencyKey]) {
    const previous = idempotency[idempotencyKey];
    const age = Date.now() - Date.parse(previous.startedAt || previous.sentAt || 0);
    if (previous.state === 'SENT' || previous.state === 'UNKNOWN' || (previous.state === 'SENDING' && age < AMBIGUOUS_LOCK_MS)) {
      return publicDeliveryRecord(previous, true);
    }
  }

  const record = {
    state: 'SENDING',
    phone,
    filename,
    startedAt: new Date().toISOString(),
    messageId: null,
    sentAt: null
  };
  if (idempotencyKey) {
    idempotency[idempotencyKey] = record;
    persistIdempotency();
  }

  try {
    const result = await wahaRequest('POST', '/api/sendFile', {
      session: WAHA_SESSION,
      chatId: `${phone}@c.us`,
      caption,
      file: { mimetype: 'application/pdf', filename, data: pdfBase64 }
    });

    record.state = 'SENT';
    record.messageId = result && (result.id || result.key || result.messageId) || null;
    record.sentAt = new Date().toISOString();
    if (idempotencyKey) {
      idempotency[idempotencyKey] = record;
      persistIdempotency();
    }
    if (audit) recordActivitySafe(activityMeta(payload, audit.actor, audit.documentType, audit.kind, 'SENT', record));
    return publicDeliveryRecord(record, false);
  } catch (error) {
    if (isAmbiguousSendError(error)) {
      record.state = 'UNKNOWN';
      record.error = String(error.message || 'Ambiguous WAHA send error');
      record.errorAt = new Date().toISOString();
      if (idempotencyKey) {
        idempotency[idempotencyKey] = record;
        persistIdempotency();
      }
      if (audit) recordActivitySafe(activityMeta(payload, audit.actor, audit.documentType, audit.kind, 'UNKNOWN', record, error));
      console.warn(new Date().toISOString(), 'Ambiguous WhatsApp send; automatic retry locked', {
        phone, filename, idempotencyKey, error: error.message
      });
      return publicDeliveryRecord(record, false);
    }

    if (idempotencyKey) {
      delete idempotency[idempotencyKey];
      persistIdempotency();
    }
    if (audit) recordActivitySafe(activityMeta(payload, audit.actor, audit.documentType, audit.kind, 'FAILED', record, error));
    throw error;
  }
}

async function sendStoredDocument(payload, audit) {
  let pdfBase64;
  try {
    pdfBase64 = await fetchStoredPdfBase64(payload.pdfUrl);
  } catch (error) {
    if (audit) recordActivitySafe(activityMeta(payload, audit.actor, audit.documentType, audit.kind, 'FAILED', null, error));
    throw error;
  }
  return sendDocument({
    ...payload,
    pdfBase64,
    filename: safeFilename(payload.filename)
  }, audit);
}

async function getConversationContext(referenceValue, detail, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const session = await getSession();
  if (!session || session.status !== 'WORKING') {
    const error = new Error(`WhatsApp is not ready (${session ? session.status : 'MISSING'})`);
    error.statusCode = 503;
    error.details = publicSession(session);
    throw error;
  }

  const reference = canonicalQuoteReference(referenceValue);
  const client = detail && detail.cliente && typeof detail.cliente === 'object' ? detail.cliente : {};
  const followup = detail && detail.seguimiento && typeof detail.seguimiento === 'object' ? detail.seguimiento : {};
  const quote = detail && detail.cotizacion && typeof detail.cotizacion === 'object' ? detail.cotizacion : {};
  const phone = normalizePhone(client.telefono || followup.telefono || '');
  const chatId = `${phone}@c.us`;
  const limit = Math.max(1, Math.min(80, Number(opts.limit || 50)));
  const quoteMs = conversation.timestampMs(quote.fecha);
  const canonicalSinceMs = quoteMs ? Math.max(0, quoteMs - 7 * 24 * 60 * 60 * 1000) : 0;
  const requestedSinceMs = conversation.timestampMs(opts.since);
  const sinceMs = Math.max(canonicalSinceMs, requestedSinceMs || 0);
  const params = new URLSearchParams({
    limit: String(limit),
    downloadMedia: 'false'
  });
  if (sinceMs) params.set('filter.timestamp.gte', String(Math.floor(sinceMs / 1000)));

  let rawMessages = [];
  try {
    rawMessages = await wahaRequest(
      'GET',
      `/api/${encodeURIComponent(WAHA_SESSION)}/chats/${encodeURIComponent(chatId)}/messages?${params.toString()}`
    );
  } catch (error) {
    if (Number(error.statusCode || 0) !== 404) throw error;
  }

  const messages = conversation.normalizeMessages(rawMessages, { since: opts.since, limit });
  const activity = conversation.normalizeActivity(ops.getActivity(150), {
    phone,
    since: opts.since,
    reference
  });
  const evidence = conversation.buildConversationEvidence(messages, activity);

  return {
    ok: true,
    source: 'WAHA_WEBJS',
    reference,
    session: WAHA_SESSION,
    messages,
    activity,
    evidence,
    serverTime: new Date().toISOString()
  };
}

function canonicalQuoteReference(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/^COT\s*[-:#]?\s*([A-Z0-9._-]{1,80})$/i);
  if (!match) throw Object.assign(new Error('Invalid quote reference'), { statusCode: 400 });
  return `COT-${match[1]}`;
}

function quoteNumberFromReference(value) {
  return canonicalQuoteReference(value).slice(4);
}

function documentPermission(payload, actor) {
  const documentType = String(payload && payload.documentType || '').trim().toLowerCase();
  const requiredPermission = DOCUMENT_PERMISSIONS[documentType];
  if (!requiredPermission && !actor.internal) {
    throw Object.assign(new Error('Invalid documentType'), { statusCode: 400 });
  }
  auth.assertPermission(actor, requiredPermission);
  return documentType;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://bridge.local');

  if (!auth.applyCors(req, res)) return json(res, 403, { ok: false, error: 'Origin not allowed' });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'homeeasy-whatsapp-bridge',
      version: BRIDGE_VERSION,
      storage: ops.storageStatus()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/status') {
    const actor = await auth.authorize(req, 'config.read');
    const session = await getSession();
    return json(res, 200, {
      ok: true,
      whatsapp: publicSession(session),
      bridge: { version: BRIDGE_VERSION, serverTime: new Date().toISOString(), storage: ops.storageStatus() },
      actor: auth.publicActor(actor),
      capabilities: capabilities(actor)
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/activity') {
    await auth.authorize(req, 'config.read');
    return json(res, 200, {
      ok: true,
      items: ops.getActivity(url.searchParams.get('limit') || 60)
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/conversation') {
    await auth.authorize(req, 'cotizaciones.read');
    const reference = canonicalQuoteReference(url.searchParams.get('reference') || '');
    const detail = await auth.readFollowupDetail(req, quoteNumberFromReference(reference));
    const result = await getConversationContext(reference, detail, {
      since: url.searchParams.get('since') || '',
      limit: url.searchParams.get('limit') || 50
    });
    return json(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/templates') {
    await auth.authorize(req);
    return json(res, 200, { ok: true, ...ops.templatePayload() });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/templates') {
    const actor = await auth.authorize(req, 'config.read');
    const payload = await readJsonBody(req);
    const saved = ops.saveTemplates(payload.templates, auth.publicActor(actor));
    return json(res, 200, { ok: true, ...saved });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/templates/reset') {
    const actor = await auth.authorize(req, 'config.read');
    const saved = ops.resetTemplates(auth.publicActor(actor));
    return json(res, 200, { ok: true, ...saved });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/bootstrap') {
    const actor = await auth.authorize(req, 'config.read');
    const session = await ensureSessionStarted();
    return json(res, 200, { ok: true, whatsapp: publicSession(session), actor: auth.publicActor(actor) });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/restart') {
    const actor = await auth.authorize(req, 'config.read');
    const session = await getSession();
    if (!session) {
      const created = await ensureSessionStarted();
      return json(res, 200, { ok: true, whatsapp: publicSession(created), actor: auth.publicActor(actor) });
    }
    const restarted = await wahaRequest('POST', `/api/sessions/${encodeURIComponent(WAHA_SESSION)}/restart`, {});
    return json(res, 200, { ok: true, whatsapp: publicSession(restarted), actor: auth.publicActor(actor) });
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/qr') {
    const actor = await auth.authorize(req, 'config.read');
    const session = await ensureSessionStarted();
    if (session.status === 'WORKING') {
      return json(res, 409, { ok: false, error: 'WhatsApp is already connected', whatsapp: publicSession(session), actor: auth.publicActor(actor) });
    }
    try {
      const qr = await wahaRequest('GET', `/api/${encodeURIComponent(WAHA_SESSION)}/auth/qr`, null, 'application/json');
      return json(res, 200, { ok: true, qr, actor: auth.publicActor(actor) });
    } catch (error) {
      if (error.statusCode === 422) {
        return json(res, 409, { ok: false, error: 'QR is not available in the current session state', whatsapp: publicSession(await getSession()), actor: auth.publicActor(actor) });
      }
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/test-message') {
    const actor = await auth.authorize(req, 'config.read');
    const payload = await readJsonBody(req);
    const result = await sendText(payload.phone, payload.text, {
      actor,
      payload: { ...payload, source: 'configuracion', reference: 'PRUEBA MENSAJE', clientName: 'Prueba HomeEasy' }
    });
    return json(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/test-document') {
    const actor = await auth.authorize(req, 'config.read');
    const payload = await readJsonBody(req);
    const testPayload = {
      documentType: 'prueba',
      phone: payload.phone,
      pdfBase64: ops.testPdfBase64(),
      filename: 'Prueba_WhatsApp_HomeEasy.pdf',
      caption: 'Prueba de documentos HomeEasy ✅ Si recibes este PDF, el canal de WhatsApp está funcionando correctamente.',
      idempotencyKey: `test-pdf:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      source: 'configuracion',
      reference: 'PRUEBA PDF',
      clientName: 'Prueba HomeEasy',
      resend: false
    };
    const result = await sendDocument(testPayload, { actor, documentType: 'prueba', kind: 'test' });
    return json(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/send-document') {
    const actor = await auth.authorize(req);
    const payload = await readJsonBody(req);
    const documentType = documentPermission(payload, actor);
    const result = await sendDocument(payload, { actor, documentType, kind: 'document' });
    const status = result.delivery === 'UNKNOWN' || result.delivery === 'SENDING' ? 202 : 200;
    return json(res, status, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/send-document-url') {
    const actor = await auth.authorize(req);
    const payload = await readJsonBody(req);
    const documentType = documentPermission(payload, actor);
    const result = await sendStoredDocument(payload, { actor, documentType, kind: 'document' });
    const status = result.delivery === 'UNKNOWN' || result.delivery === 'SENDING' ? 202 : 200;
    return json(res, status, result);
  }

  return json(res, 404, { ok: false, error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    const statusCode = Number(error.statusCode || 500);
    console.error(new Date().toISOString(), req.method, req.url, error.message, error.details || '');
    json(res, statusCode >= 400 && statusCode < 600 ? statusCode : 500, {
      ok: false,
      error: error.message || 'Unexpected error',
      ...(statusCode < 500 && error.details ? { details: error.details } : {})
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HomeEasy WhatsApp Bridge v${BRIDGE_VERSION} listening on :${PORT}`);
});
