'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const WAHA_BASE_URL = String(process.env.WAHA_BASE_URL || 'http://waha:3000').replace(/\/$/, '');
const WAHA_API_KEY = String(process.env.WAHA_API_KEY || '');
const WAHA_SESSION = String(process.env.WAHA_SESSION || 'homeeasy');
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || '');
const MAX_BODY_MB = Math.max(2, Number(process.env.MAX_BODY_MB || 18));
const MAX_BODY_BYTES = MAX_BODY_MB * 1024 * 1024;
const DATA_DIR = String(process.env.DATA_DIR || '/app/data');
const IDEMPOTENCY_FILE = path.join(DATA_DIR, 'idempotency.json');

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

function timingSafeTextEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req) {
  return timingSafeTextEqual(req.headers['x-homeeasy-token'], BRIDGE_TOKEN);
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
    signal: AbortSignal.timeout(30000)
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
      config: {
        webjs: { tagsEventsOn: false }
      }
    });
    return session;
  }
  if (session.status === 'STOPPED') {
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

async function sendDocument(payload) {
  const session = await getSession();
  if (!session || session.status !== 'WORKING') {
    const error = new Error(`WhatsApp is not ready (${session ? session.status : 'MISSING'})`);
    error.statusCode = 503;
    error.details = publicSession(session);
    throw error;
  }

  const phone = normalizePhone(payload.phone);
  const pdfBase64 = cleanPdfBase64(payload.pdfBase64);
  const filename = safeFilename(payload.filename);
  const caption = String(payload.caption || '').trim().slice(0, 1000);
  const idempotencyKey = String(payload.idempotencyKey || '').trim().slice(0, 180);

  if (idempotencyKey && idempotency[idempotencyKey]) {
    return Object.assign({ duplicate: true }, idempotency[idempotencyKey]);
  }

  const result = await wahaRequest('POST', '/api/sendFile', {
    session: WAHA_SESSION,
    chatId: `${phone}@c.us`,
    caption,
    file: {
      mimetype: 'application/pdf',
      filename,
      data: pdfBase64
    }
  });

  const compact = {
    ok: true,
    duplicate: false,
    phone,
    filename,
    messageId: result && (result.id || result.key || result.messageId) || null,
    sentAt: new Date().toISOString()
  };

  if (idempotencyKey) {
    idempotency[idempotencyKey] = compact;
    persistIdempotency();
  }
  return compact;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://bridge.local');

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'homeeasy-whatsapp-bridge', version: '0.1.0' });
  }

  if (!authorized(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/status') {
    const session = await getSession();
    return json(res, 200, { ok: true, whatsapp: publicSession(session) });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/bootstrap') {
    const session = await ensureSessionStarted();
    return json(res, 200, { ok: true, whatsapp: publicSession(session) });
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/restart') {
    const session = await getSession();
    if (!session) {
      const created = await ensureSessionStarted();
      return json(res, 200, { ok: true, whatsapp: publicSession(created) });
    }
    const restarted = await wahaRequest('POST', `/api/sessions/${encodeURIComponent(WAHA_SESSION)}/restart`, {});
    return json(res, 200, { ok: true, whatsapp: publicSession(restarted) });
  }

  if (req.method === 'GET' && url.pathname === '/api/whatsapp/qr') {
    const session = await ensureSessionStarted();
    if (session.status === 'WORKING') return json(res, 409, { ok: false, error: 'WhatsApp is already connected', whatsapp: publicSession(session) });
    try {
      const qr = await wahaRequest('GET', `/api/${encodeURIComponent(WAHA_SESSION)}/auth/qr`, null, 'application/json');
      return json(res, 200, { ok: true, qr });
    } catch (error) {
      if (error.statusCode === 422) return json(res, 409, { ok: false, error: 'QR is not available in the current session state', whatsapp: publicSession(await getSession()) });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/whatsapp/send-document') {
    const payload = await readJsonBody(req);
    const result = await sendDocument(payload);
    return json(res, 200, result);
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
  console.log(`HomeEasy WhatsApp Bridge listening on :${PORT}`);
});
