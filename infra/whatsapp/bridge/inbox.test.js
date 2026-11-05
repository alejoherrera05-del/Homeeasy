'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const TEST_RUNTIME_DIR = path.join(__dirname, '.test-data', 'operations');
fs.mkdirSync(TEST_RUNTIME_DIR, { recursive: true });
process.env.DATA_DIR = TEST_RUNTIME_DIR;
const { createInbox } = require('./inbox');
const auth = require('./auth');
const conversation = require('./conversation');
const operations = require('./operations');

const SECRET = 'test-webhook-secret-with-enough-entropy';

test.after(() => fs.rmSync(path.join(__dirname, '.test-data'), { recursive: true, force: true }));

function tempDir(t) {
  const base = path.join(__dirname, '.test-data');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'homeeasy-inbox-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function event(overrides) {
  const payload = {
    id: 'false_573001112233@c.us_AAAAA',
    timestamp: 1793836800,
    from: '573001112233@c.us',
    to: '573009998877@c.us',
    fromMe: false,
    body: 'Hola, quisiera conocer la disponibilidad.',
    hasMedia: false,
    type: 'chat',
    ...(overrides && overrides.payload || {})
  };
  return {
    id: 'evt_01TEST',
    timestamp: 1793836800000,
    event: 'message',
    session: 'homeeasy',
    engine: 'WEBJS',
    ...overrides,
    payload
  };
}

function requestBody(value) {
  const raw = Buffer.from(JSON.stringify(value));
  return {
    raw,
    headers: {
      'x-webhook-hmac-algorithm': 'sha512',
      'x-webhook-hmac': crypto.createHmac('sha512', SECRET).update(raw).digest('hex')
    }
  };
}

function ingest(inbox, value) {
  const request = requestBody(value);
  return inbox.ingest(request.raw, request.headers);
}

test('persists a valid incoming message and exposes only bounded metadata', t => {
  const inbox = createInbox({ dataDir: tempDir(t), enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  assert.deepEqual(ingest(inbox, event()), {
    ok: true,
    accepted: true,
    id: 'false_573001112233@c.us_AAAAA'
  });
  const page = inbox.list({ limit: 10, offset: 0 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].direction, 'INCOMING');
  assert.equal(page.items[0].phone, '573001112233');
  assert.equal(page.items[0].text, 'Hola, quisiera conocer la disponibilidad.');
  assert.deepEqual(page.items[0].media, { present: false, mimetype: '', filename: '' });
  assert.equal(page.pagination.nextOffset, null);
});

test('captures outgoing messages and still ignores groups, status and broadcasts', t => {
  const inbox = createInbox({ dataDir: tempDir(t), enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  assert.equal(ingest(inbox, event({ event: 'message.any', payload: { id: 'out-human', fromMe: true, source: 'app' } })).accepted, true);
  const outgoing = inbox.list({}).items[0];
  assert.equal(outgoing.direction, 'OUTGOING');
  assert.equal(outgoing.senderKind, 'HUMAN');
  assert.equal(ingest(inbox, event({ payload: { id: 'group-1', from: '120363000000@g.us' } })).reason, 'GROUP');
  assert.equal(ingest(inbox, event({ payload: { id: 'status-1', from: 'status@broadcast' } })).reason, 'STATUS');
  assert.equal(ingest(inbox, event({ payload: { id: 'broadcast-1', from: '123@broadcast' } })).reason, 'BROADCAST');
  assert.equal(inbox.status().count, 1);
});

test('distinguishes system sends and preserves only verified Meta referral metadata', t => {
  const inbox = createInbox({ dataDir: tempDir(t), enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  ingest(inbox, event({ payload: { id: 'out-api', fromMe: true, source: 'api', body: 'Mensaje enviado por el sistema' } }));
  ingest(inbox, event({ payload: { id: 'meta-in', body: 'Qué precio tiene?', ctwaContext: {
    sourceType: 'INSTAGRAM', sourceId: 'ad-123', sourceUrl: 'https://instagram.com/example',
    headline: 'Persianas para tu hogar', secret: 'not-stored'
  } } }));
  const items = inbox.list({ limit: 10 }).items;
  const system = items.find(item => item.id === 'out-api');
  const meta = items.find(item => item.id === 'meta-in');
  assert.equal(system.senderKind, 'SYSTEM');
  assert.deepEqual(meta.commercialOrigin, {
    channel: 'WHATSAPP', campaign: 'META', platform: 'INSTAGRAM', verified: true,
    sourceId: 'ad-123', sourceUrl: 'https://instagram.com/example',
    headline: 'Persianas para tu hogar', body: null
  });
  assert.doesNotMatch(JSON.stringify(meta), /not-stored/);
});

test('deduplicates message ids across process restarts', t => {
  const dir = tempDir(t);
  const first = createInbox({ dataDir: dir, enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  assert.equal(ingest(first, event()).accepted, true);
  assert.equal(ingest(first, event()).reason, 'DUPLICATE');
  const restarted = createInbox({ dataDir: dir, enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  const duplicate = ingest(restarted, event());
  assert.equal(duplicate.duplicate, true);
  assert.equal(restarted.status().count, 1);
});

test('keeps LID and resolved phone identifiers when available', t => {
  const inbox = createInbox({ dataDir: tempDir(t), enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  const result = ingest(inbox, event({ payload: {
    id: 'false_123456789@lid_LIDTEST',
    from: '123456789@lid',
    _data: { Info: { SenderAlt: '573001112233@s.whatsapp.net' } }
  } }));
  assert.equal(result.accepted, true);
  const item = inbox.list({}).items[0];
  assert.equal(item.lid, '123456789@lid');
  assert.equal(item.phone, '573001112233');
});

test('does not store media URLs or download attachments', t => {
  const inbox = createInbox({ dataDir: tempDir(t), enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  ingest(inbox, event({ payload: {
    id: 'media-1',
    body: '',
    hasMedia: true,
    media: { mimetype: 'image/jpeg', filename: 'foto.jpg', url: 'http://waha:3000/api/files/private.jpg' }
  } }));
  const serialized = JSON.stringify(inbox.list({}).items[0]);
  assert.match(serialized, /foto\.jpg/);
  assert.doesNotMatch(serialized, /private\.jpg|media\.url/);
});

test('rejects invalid or unauthenticated events', t => {
  const inbox = createInbox({ dataDir: tempDir(t), enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  const raw = Buffer.from(JSON.stringify(event()));
  assert.throws(() => inbox.ingest(raw, {}), error => error.statusCode === 401);
  assert.throws(() => inbox.ingest(raw, {
    'x-webhook-hmac-algorithm': 'sha512',
    'x-webhook-hmac': '0'.repeat(128)
  }), error => error.statusCode === 401);
  const invalid = requestBody({ event: 'message', session: 'other', payload: {} });
  assert.throws(() => inbox.ingest(invalid.raw, invalid.headers), error => error.statusCode === 403);
});

test('defaults to disabled and supports a persistent immediate kill switch', t => {
  const dir = tempDir(t);
  const disabled = createInbox({ dataDir: dir, session: 'homeeasy', webhookSecret: SECRET });
  assert.equal(ingest(disabled, event()).reason, 'DISABLED');
  const enabled = createInbox({ dataDir: dir, enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  enabled.disable();
  assert.equal(ingest(enabled, event()).reason, 'DISABLED');
  const restarted = createInbox({ dataDir: dir, enabled: true, session: 'homeeasy', webhookSecret: SECRET });
  assert.equal(restarted.status().killSwitch, true);
  restarted.enable();
  assert.equal(ingest(restarted, event()).accepted, true);
});

test('rejects unauthorized inbox access through the shared HomeEasy auth guard', async () => {
  await assert.rejects(
    auth.authorize({ headers: {} }, 'config.read'),
    error => error.statusCode === 401 && /session required/i.test(error.message)
  );
});

test('preserves existing WhatsApp normalization, templates and activity reads', () => {
  const normalized = conversation.normalizeMessages([{
    id: 'existing-message',
    timestamp: 1793836800,
    fromMe: false,
    body: 'Mensaje existente'
  }]);
  assert.equal(normalized[0].direction, 'INCOMING');
  assert.equal(normalized[0].text, 'Mensaje existente');
  assert.equal(typeof operations.templatePayload().templates.cotizacion, 'string');
  assert.deepEqual(operations.getActivity(1), []);
  assert.match(operations.testPdfBase64(), /^JVBER/);
});
