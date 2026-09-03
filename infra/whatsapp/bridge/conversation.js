'use strict';

function clean(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, maxLength || 1000);
}

function phoneDigits(value) {
  let digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^3\d{9}$/.test(digits)) digits = `57${digits}`;
  return digits;
}

function timestampMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? Math.round(numeric) : Math.round(numeric * 1000);
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoTimestamp(value) {
  const ms = timestampMs(value);
  return ms ? new Date(ms).toISOString() : '';
}

function mediaLabel(message) {
  const source = message && typeof message === 'object' ? message : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const mimetype = clean(media.mimetype || source.mimetype || '', 120).toLowerCase();
  const filename = clean(media.filename || source.filename || '', 220);
  if (filename) return `[Archivo: ${filename}]`;
  if (mimetype.includes('pdf')) return '[Documento PDF]';
  if (mimetype.startsWith('image/')) return '[Imagen]';
  if (mimetype.startsWith('audio/')) return '[Audio]';
  if (mimetype.startsWith('video/')) return '[Video]';
  if (source.hasMedia) return '[Archivo adjunto]';
  return '';
}

function normalizeMessages(raw, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const sinceMs = timestampMs(opts.since);
  const limit = Math.max(1, Math.min(80, Number(opts.limit || 50)));
  const source = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.data)
      ? raw.data
      : raw && Array.isArray(raw.items)
        ? raw.items
        : [];

  const seen = new Set();
  const out = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const atMs = timestampMs(item.timestamp || item.t || item.createdAt);
    if (sinceMs && atMs && atMs < sinceMs) continue;
    const id = clean(item.id || item.messageId || item.key && item.key.id || '', 240);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);

    const body = clean(item.body || item.text || item.caption || item.content || '', 1800);
    const media = mediaLabel(item);
    if (!body && !media) continue;

    const fromMe = item.fromMe === true || Boolean(item.key && item.key.fromMe === true);
    out.push({
      id,
      at: atMs ? new Date(atMs).toISOString() : '',
      direction: fromMe ? 'OUTGOING' : 'INCOMING',
      text: body || media,
      hasMedia: Boolean(item.hasMedia || media),
      media: media || '',
      source: clean(item.source || '', 40),
      ack: clean(item.ackName || item.ack || '', 40)
    });
  }

  out.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  return out.slice(-limit);
}

function normalizeReference(value) {
  return clean(value, 120)
    .toUpperCase()
    .replace(/COTIZACI[ÓO]N/g, 'COT')
    .replace(/[^A-Z0-9]+/g, '');
}

function normalizeActivity(raw, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const targetPhone = phoneDigits(opts.phone);
  const sinceMs = timestampMs(opts.since);
  const reference = normalizeReference(opts.reference);
  const source = Array.isArray(raw) ? raw : [];
  const out = [];

  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    if (targetPhone && phoneDigits(item.phone) !== targetPhone) continue;
    const atMs = timestampMs(item.at);
    if (sinceMs && atMs && atMs < sinceMs) continue;
    const itemReference = normalizeReference(item.reference);
    const referenceMatch = Boolean(reference && itemReference && (
      itemReference === reference || itemReference.endsWith(reference) || reference.endsWith(itemReference)
    ));
    out.push({
      at: atMs ? new Date(atMs).toISOString() : '',
      kind: clean(item.kind, 40),
      state: clean(item.state, 40).toUpperCase(),
      documentType: clean(item.documentType, 40).toLowerCase(),
      reference: clean(item.reference, 120),
      referenceMatch,
      filename: clean(item.filename, 220),
      source: clean(item.source, 60),
      messageId: clean(item.messageId, 240)
    });
  }
  out.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  return out.slice(-80);
}

function buildConversationEvidence(messages, activity) {
  const rows = Array.isArray(messages) ? messages : [];
  const acts = Array.isArray(activity) ? activity : [];
  const incoming = rows.filter(item => item.direction === 'INCOMING');
  const outgoing = rows.filter(item => item.direction === 'OUTGOING');
  const quoteDelivery = [...acts].reverse().find(item => (
    item.referenceMatch && item.documentType === 'cotizacion' && ['SENT', 'UNKNOWN'].includes(item.state)
  )) || null;
  const lastIncoming = incoming.length ? incoming[incoming.length - 1] : null;
  const lastOutgoing = outgoing.length ? outgoing[outgoing.length - 1] : null;
  const customerRepliedAfterLastOutgoing = Boolean(
    lastIncoming && lastOutgoing && Date.parse(lastIncoming.at || 0) > Date.parse(lastOutgoing.at || 0)
  );
  const customerRepliedAfterQuote = Boolean(
    lastIncoming && quoteDelivery && Date.parse(lastIncoming.at || 0) > Date.parse(quoteDelivery.at || 0)
  );
  return {
    messageCount: rows.length,
    incomingCount: incoming.length,
    outgoingCount: outgoing.length,
    lastIncomingAt: lastIncoming ? lastIncoming.at : null,
    lastOutgoingAt: lastOutgoing ? lastOutgoing.at : null,
    customerRepliedAfterLastOutgoing,
    quoteDelivery: quoteDelivery ? {
      at: quoteDelivery.at,
      state: quoteDelivery.state,
      reference: quoteDelivery.reference,
      filename: quoteDelivery.filename
    } : null,
    customerRepliedAfterQuote
  };
}

module.exports = Object.freeze({
  clean,
  phoneDigits,
  timestampMs,
  isoTimestamp,
  normalizeMessages,
  normalizeActivity,
  buildConversationEvidence
});
