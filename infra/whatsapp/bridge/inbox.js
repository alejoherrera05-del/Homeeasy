'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const conversation = require('./conversation');

const FILE_NAME = 'events.ndjson';
const DISABLED_FILE = 'disabled';
const MAX_TEXT_LENGTH = 4000;
const MAX_ID_LENGTH = 260;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || '').trim().toLowerCase());
  const b = Buffer.from(String(right || '').trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function jid(value) {
  return conversation.clean(value, 200).toLowerCase();
}

function jidKind(value) {
  const id = jid(value);
  if (!id) return 'UNKNOWN';
  if (id === 'status@broadcast') return 'STATUS';
  if (id.endsWith('@g.us')) return 'GROUP';
  if (id.endsWith('@newsletter')) return 'CHANNEL';
  if (id.endsWith('@broadcast')) return 'BROADCAST';
  if (id.endsWith('@lid')) return 'LID';
  if (id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net')) return 'PHONE';
  return 'UNKNOWN';
}

function phoneFromJid(value) {
  const id = jid(value);
  return ['PHONE'].includes(jidKind(id)) ? conversation.phoneDigits(id.split('@')[0]) : '';
}

function firstPhoneCandidate(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const candidates = [
    source.phone,
    source.pn,
    source.fromAlt,
    source.senderAlt,
    source._data && source._data.Info && source._data.Info.SenderAlt,
    source._data && source._data.info && source._data.info.senderAlt,
    source._data && source._data.id && source._data.id.remote,
    source._data && source._data.key && source._data.key.remoteJidAlt
  ];
  for (const value of candidates) {
    const phone = phoneFromJid(value) || (/^\+?\d{8,15}$/.test(String(value || '')) ? conversation.phoneDigits(value) : '');
    if (phone) return phone;
  }
  return '';
}

function ignoredKind(payload) {
  const values = [payload.from, payload.to, payload.chatId, payload.participant];
  for (const value of values) {
    const kind = jidKind(value);
    if (['GROUP', 'STATUS', 'CHANNEL', 'BROADCAST'].includes(kind)) return kind;
  }
  return '';
}

function publicMedia(payload) {
  const media = payload && payload.media && typeof payload.media === 'object' ? payload.media : {};
  return {
    present: Boolean(payload && (payload.hasMedia || media.mimetype || media.filename)),
    mimetype: conversation.clean(media.mimetype || payload && payload.mimetype || '', 120),
    filename: conversation.clean(media.filename || payload && payload.filename || '', 220)
  };
}

function normalizeEvent(event, expectedSession) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw Object.assign(new Error('Invalid WAHA event'), { statusCode: 400 });
  }
  if (conversation.clean(event.event, 40) !== 'message') {
    return { accepted: false, reason: 'UNSUPPORTED_EVENT' };
  }
  const session = conversation.clean(event.session, 120);
  if (!session || session !== expectedSession) {
    throw Object.assign(new Error('Unexpected WAHA session'), { statusCode: 403 });
  }
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Invalid WAHA message payload'), { statusCode: 400 });
  }
  if (payload.fromMe === true || payload.key && payload.key.fromMe === true) {
    return { accepted: false, reason: 'OUTGOING' };
  }
  const excluded = ignoredKind(payload);
  if (excluded) return { accepted: false, reason: excluded };

  const messageId = conversation.clean(payload.id || payload.messageId || payload.key && payload.key.id || '', MAX_ID_LENGTH);
  if (!messageId) throw Object.assign(new Error('WAHA message id is required'), { statusCode: 400 });

  const normalized = conversation.normalizeMessages([payload], { limit: 1 })[0];
  const text = conversation.clean(payload.body || payload.text || payload.caption || payload.content || '', MAX_TEXT_LENGTH);
  const media = publicMedia(payload);
  if (!normalized && !text && !media.present) return { accepted: false, reason: 'EMPTY' };

  const chatId = jid(payload.chatId || payload.from);
  const kind = jidKind(chatId);
  if (!['PHONE', 'LID'].includes(kind)) return { accepted: false, reason: 'UNSUPPORTED_CHAT' };
  const lid = kind === 'LID' ? chatId : jidKind(payload.participant) === 'LID' ? jid(payload.participant) : '';
  const phone = phoneFromJid(chatId) || firstPhoneCandidate(payload);
  const at = conversation.isoTimestamp(payload.timestamp || payload.t || payload.createdAt) || new Date().toISOString();

  return {
    accepted: true,
    record: {
      id: messageId,
      eventId: conversation.clean(event.id, MAX_ID_LENGTH),
      session,
      engine: conversation.clean(event.engine, 30).toUpperCase(),
      at,
      receivedAt: new Date().toISOString(),
      direction: 'INCOMING',
      chatId,
      phone: phone || null,
      lid: lid || null,
      text,
      messageType: conversation.clean(payload.type || payload._data && payload._data.type || (media.present ? 'media' : 'chat'), 60),
      media
    }
  };
}

function readRecords(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const records = [];
    let repaired = false;
    for (let index = 0; index < lines.length; index += 1) {
      try {
        records.push(JSON.parse(lines[index]));
      } catch (error) {
        if (index !== lines.length - 1) throw error;
        repaired = true;
      }
    }
    if (repaired) {
      const body = records.length ? `${records.map(item => JSON.stringify(item)).join('\n')}\n` : '';
      fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
    }
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function createInbox(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const dataDir = path.resolve(String(opts.dataDir || '/app/data'), 'hommy-inbox');
  const file = path.join(dataDir, FILE_NAME);
  const disabledFile = path.join(dataDir, DISABLED_FILE);
  const configured = opts.enabled === true;
  const session = String(opts.session || 'homeeasy').trim();
  const webhookSecret = String(opts.webhookSecret || '');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const records = readRecords(file);
  const ids = new Set(records.map(item => String(item && item.id || '')).filter(Boolean));

  function enabled() {
    return configured && !fs.existsSync(disabledFile);
  }

  function verify(rawBody, headers) {
    if (!webhookSecret) throw Object.assign(new Error('WAHA webhook authentication is not configured'), { statusCode: 503 });
    const algorithm = String(headers && headers['x-webhook-hmac-algorithm'] || '').trim().toLowerCase();
    const signature = String(headers && headers['x-webhook-hmac'] || '').trim();
    if (algorithm !== 'sha512' || !/^[a-f0-9]{128}$/i.test(signature)) {
      throw Object.assign(new Error('WAHA webhook authentication required'), { statusCode: 401 });
    }
    const expected = crypto.createHmac('sha512', webhookSecret).update(rawBody).digest('hex');
    if (!safeEqual(signature, expected)) {
      throw Object.assign(new Error('Invalid WAHA webhook signature'), { statusCode: 401 });
    }
  }

  function ingest(rawBody, headers) {
    const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
    verify(bytes, headers || {});
    let event;
    try { event = JSON.parse(bytes.toString('utf8')); } catch (_) {
      throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
    }
    if (!enabled()) return { ok: true, accepted: false, reason: 'DISABLED' };
    const result = normalizeEvent(event, session);
    if (!result.accepted) return { ok: true, ...result };
    if (ids.has(result.record.id)) return { ok: true, accepted: false, duplicate: true, reason: 'DUPLICATE' };
    fs.appendFileSync(file, `${JSON.stringify(result.record)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' });
    ids.add(result.record.id);
    records.push(result.record);
    return { ok: true, accepted: true, id: result.record.id };
  }

  function list(query) {
    const source = query && typeof query === 'object' ? query : {};
    const limit = Math.max(1, Math.min(100, Number(source.limit || 50) || 50));
    const offset = Math.max(0, Number(source.offset || 0) || 0);
    const newest = records.slice().reverse();
    const items = newest.slice(offset, offset + limit);
    const nextOffset = offset + items.length < newest.length ? offset + items.length : null;
    return { items, pagination: { offset, limit, total: newest.length, nextOffset } };
  }

  function disable() {
    fs.writeFileSync(disabledFile, `${new Date().toISOString()}\n`, { encoding: 'utf8', mode: 0o600 });
    return status();
  }

  function enable() {
    if (fs.existsSync(disabledFile)) fs.unlinkSync(disabledFile);
    return status();
  }

  function status() {
    return { configured, enabled: enabled(), count: records.length, killSwitch: fs.existsSync(disabledFile) };
  }

  return Object.freeze({ ingest, list, disable, enable, status });
}

module.exports = Object.freeze({ createInbox, normalizeEvent, jidKind });
