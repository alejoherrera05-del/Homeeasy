from pathlib import Path

server_path = Path('infra/whatsapp/bridge/server.js')
updater_path = Path('infra/whatsapp/update-bridge.sh')

server = server_path.read_text(encoding='utf-8')
server = server.replace("const BRIDGE_VERSION = '0.6.1';", "const BRIDGE_VERSION = '0.7.0';", 1)
server = server.replace("const path = require('path');", "const path = require('path');\nconst crypto = require('crypto');", 1)

helper_anchor = "async function sendDocument(payload, audit) {"
helper_block = r'''
function cleanFollowupText(value) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text) throw Object.assign(new Error('Follow-up message is required'), { statusCode: 400, details: { code: 'FOLLOWUP_MESSAGE_REQUIRED' } });
  if (text.length > 1200) throw Object.assign(new Error('Follow-up message is too long'), { statusCode: 400, details: { code: 'FOLLOWUP_MESSAGE_TOO_LONG' } });
  if (text.split(/\s+/).filter(Boolean).length > 130) {
    throw Object.assign(new Error('Follow-up message exceeds 130 words'), { statusCode: 400, details: { code: 'FOLLOWUP_MESSAGE_TOO_LONG' } });
  }
  return text;
}

function cleanFollowupPlanId(value) {
  const planId = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{6,120}$/.test(planId)) {
    throw Object.assign(new Error('Invalid follow-up plan id'), { statusCode: 400, details: { code: 'FOLLOWUP_PLAN_ID_INVALID' } });
  }
  return planId;
}

function followupExpectedVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw Object.assign(new Error('Invalid follow-up state version'), { statusCode: 400, details: { code: 'FOLLOWUP_STATE_VERSION_INVALID' } });
  }
  return version;
}

function followupMessageHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function assertFollowupSendable(detail, expectedVersion) {
  const quote = detail && detail.cotizacion && typeof detail.cotizacion === 'object' ? detail.cotizacion : {};
  const state = detail && detail.seguimiento && typeof detail.seguimiento === 'object' ? detail.seguimiento : {};
  const currentVersion = Number(state.estadoVersion || state.estado_version || 0);
  if (currentVersion !== expectedVersion) {
    throw Object.assign(new Error('Follow-up state changed after analysis'), {
      statusCode: 409,
      details: { code: 'FOLLOWUP_STATE_CHANGED', expectedVersion, currentVersion }
    });
  }
  const mode = String(state.modo || 'REVIEW').trim().toUpperCase();
  const followupState = String(state.estado || 'ACTIVE').trim().toUpperCase();
  const intent = String(state.intencion || '').trim().toUpperCase();
  const documentState = String(quote.estado || '').trim().toUpperCase();
  if (mode !== 'REVIEW') {
    throw Object.assign(new Error('Human-approved follow-up send requires REVIEW mode'), {
      statusCode: 409,
      details: { code: 'FOLLOWUP_REVIEW_MODE_REQUIRED' }
    });
  }
  if (
    ['STOPPED', 'CONVERTED', 'ARCHIVED', 'PAUSED'].includes(followupState) ||
    ['NOT_INTERESTED', 'DO_NOT_CONTACT'].includes(intent) ||
    documentState.startsWith('CONVERTIDA') ||
    documentState.startsWith('ARCHIVADA')
  ) {
    throw Object.assign(new Error('This opportunity can no longer receive this follow-up'), {
      statusCode: 409,
      details: { code: 'FOLLOWUP_NOT_SENDABLE' }
    });
  }
}

function conversationChangedAfter(context, generatedAt) {
  const generatedMs = conversation.timestampMs(generatedAt);
  if (!generatedMs) {
    throw Object.assign(new Error('Invalid follow-up generation timestamp'), {
      statusCode: 400,
      details: { code: 'FOLLOWUP_GENERATED_AT_INVALID' }
    });
  }
  const rows = context && Array.isArray(context.messages) ? context.messages : [];
  const activity = context && Array.isArray(context.activity) ? context.activity : [];
  return rows.some(item => conversation.timestampMs(item && item.at) > generatedMs) ||
    activity.some(item => conversation.timestampMs(item && item.at) > generatedMs);
}

function publicFollowupDelivery(record, duplicate) {
  return {
    ok: record.state === 'SENT',
    accepted: ['SENT', 'UNKNOWN', 'SENDING'].includes(record.state),
    duplicate: Boolean(duplicate),
    delivery: record.state,
    messageId: record.messageId || null,
    sentAt: record.sentAt || null,
    startedAt: record.startedAt || null,
    note: record.state === 'UNKNOWN'
      ? 'WhatsApp returned an ambiguous error after the send attempt. HomeEasy will not resend automatically to avoid duplicates.'
      : undefined
  };
}

async function sendFollowup(payload, actor, detail) {
  const session = await getSession();
  if (!session || session.status !== 'WORKING') {
    const error = new Error(`WhatsApp is not ready (${session ? session.status : 'MISSING'})`);
    error.statusCode = 503;
    error.details = publicSession(session);
    throw error;
  }

  const reference = canonicalQuoteReference(payload && payload.reference || '');
  const planId = cleanFollowupPlanId(payload && payload.planId);
  const expectedVersion = followupExpectedVersion(payload && payload.expectedVersion);
  const generatedAt = String(payload && payload.generatedAt || '').trim();
  const text = cleanFollowupText(payload && payload.text);
  const messageHash = followupMessageHash(text);
  const idempotencyKey = `followup:${reference}:${planId}`;
  const previous = idempotency[idempotencyKey];
  if (previous) {
    if (previous.messageHash && previous.messageHash !== messageHash) {
      throw Object.assign(new Error('This Hommy plan was already used with different message text'), {
        statusCode: 409,
        details: { code: 'FOLLOWUP_PLAN_REUSED' }
      });
    }
    if (previous.expectedVersion !== undefined && Number(previous.expectedVersion) !== expectedVersion) {
      throw Object.assign(new Error('This Hommy plan was already used with another state version'), {
        statusCode: 409,
        details: { code: 'FOLLOWUP_PLAN_REUSED' }
      });
    }
    return publicFollowupDelivery(previous, true);
  }

  assertFollowupSendable(detail, expectedVersion);

  const latestContext = await getConversationContext(reference, detail, {
    since: generatedAt,
    limit: 30
  });
  if (conversationChangedAfter(latestContext, generatedAt)) {
    throw Object.assign(new Error('WhatsApp conversation changed after Hommy analyzed it'), {
      statusCode: 409,
      details: { code: 'FOLLOWUP_CONVERSATION_CHANGED' }
    });
  }

  const quote = detail && detail.cotizacion && typeof detail.cotizacion === 'object' ? detail.cotizacion : {};
  const client = detail && detail.cliente && typeof detail.cliente === 'object' ? detail.cliente : {};
  const state = detail && detail.seguimiento && typeof detail.seguimiento === 'object' ? detail.seguimiento : {};
  const phone = normalizePhone(client.telefono || state.telefono || '');

  const record = {
    state: 'SENDING',
    phone,
    filename: '',
    messageId: null,
    startedAt: new Date().toISOString(),
    reference,
    planId,
    expectedVersion,
    generatedAt,
    messageHash
  };
  idempotency[idempotencyKey] = record;
  persistIdempotency();

  const activityPayload = {
    reference,
    clientName: String(quote.nombre || '').trim(),
    phone,
    source: 'seguimiento-hommy-review',
    resend: false
  };

  try {
    const result = await wahaRequest('POST', '/api/sendText', {
      session: WAHA_SESSION,
      chatId: `${phone}@c.us`,
      text
    });
    record.state = 'SENT';
    record.messageId = result && (result.id || result.key || result.messageId) || null;
    record.sentAt = new Date().toISOString();
    idempotency[idempotencyKey] = record;
    persistIdempotency();
    recordActivitySafe(activityMeta(activityPayload, actor, 'cotizacion', 'followup', 'SENT', record));
    return publicFollowupDelivery(record, false);
  } catch (error) {
    if (isAmbiguousSendError(error)) {
      record.state = 'UNKNOWN';
      record.error = String(error.message || 'Ambiguous WAHA send error');
      record.errorAt = new Date().toISOString();
      idempotency[idempotencyKey] = record;
      persistIdempotency();
      recordActivitySafe(activityMeta(activityPayload, actor, 'cotizacion', 'followup', 'UNKNOWN', record, error));
      return publicFollowupDelivery(record, false);
    }
    delete idempotency[idempotencyKey];
    persistIdempotency();
    recordActivitySafe(activityMeta(activityPayload, actor, 'cotizacion', 'followup', 'FAILED', record, error));
    throw error;
  }
}

'''
if 'async function sendFollowup(payload, actor, detail)' not in server:
    if helper_anchor not in server:
        raise SystemExit('Could not find sendDocument anchor')
    server = server.replace(helper_anchor, helper_block + helper_anchor, 1)

route_anchor = "  if (req.method === 'POST' && url.pathname === '/api/whatsapp/test-message') {"
route_block = r'''  if (req.method === 'POST' && url.pathname === '/api/whatsapp/send-followup') {
    const actor = await auth.authorize(req, 'cotizaciones.write');
    const payload = await readJsonBody(req);
    const reference = canonicalQuoteReference(payload.reference || '');
    const detail = await auth.readFollowupDetail(req, quoteNumberFromReference(reference));
    const result = await sendFollowup({ ...payload, reference }, actor, detail);
    const status = result.delivery === 'UNKNOWN' || result.delivery === 'SENDING' ? 202 : 200;
    return json(res, status, result);
  }

'''
if "url.pathname === '/api/whatsapp/send-followup'" not in server:
    if route_anchor not in server:
        raise SystemExit('Could not find test-message route anchor')
    server = server.replace(route_anchor, route_block + route_anchor, 1)

server_path.write_text(server, encoding='utf-8')

updater = updater_path.read_text(encoding='utf-8')
updater = updater.replace('EXPECTED_VERSION="0.6.1"', 'EXPECTED_VERSION="0.7.0"', 1)
updater_path.write_text(updater, encoding='utf-8')

print('WhatsApp 10D human-approved follow-up send patch applied')
