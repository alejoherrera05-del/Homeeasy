'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.HOMEEASY_AGENT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-test-'));
const { decryptEnvelope, publicError, publicBridgeStatus, shouldSelfProbe, runJob } = require('../src/agent');
const { Logger } = require('../src/logger');

test('agent decrypts the hybrid registration envelope', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ agentToken: 'token', pentagrama: { login: 'x' } })), cipher.final()]);
  const sealed = {
    key: crypto.publicEncrypt({ key: keys.publicKey, oaepHash: 'sha256' }, contentKey).toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
  assert.equal(decryptEnvelope(sealed, keys.privateKey).agentToken, 'token');
});

test('agent executes only allowlisted health, price, catalog, live resolver and inventory jobs', async () => {
  const sync = {
    client: { get: async (route, params) => route === '/Order/GetJsonCategoryList' && params && params.level === 1 ? [] : null },
    catalog: { categories: async params => [{ id: params.scope }] },
    pricing: { supplierCost: async () => ({ basePrice: 244800, total: 244800 }) },
    liveResolver: { resolve: async payload => ({ ok: true, outcome: 'PRICE', product: payload.homeeasyId }) },
    catalogInventory: { scan: async () => ({ counts: { products: 321 }, products: [] }) },
    localModel: { build: async source => ({ version: 'local-v1', sourceVersion: source.version, summary: { enrollables: 279, fail: 0 } }) }
  };
  assert.equal((await runJob({ type: 'health' }, sync)).ok, true);
  assert.equal((await runJob({ type: 'getPrice', payload: { params: {} } }, sync)).basePrice, 244800);
  assert.deepEqual(await runJob({ type: 'catalog', payload: { operation: 'categories', params: { scope: 7 } } }, sync), [{ id: 7 }]);
  assert.equal((await runJob({ type: 'resolveLivePrice', payload: { homeeasyId: 'matte3' } }, sync)).outcome, 'PRICE');
  assert.equal((await runJob({ type: 'catalogInventory' }, sync)).counts.products, 321);
  const local = await runJob({ type: 'buildLocalEnrollablesSnapshot', payload: { source: { version: 'sheet-v1' } } }, sync);
  assert.equal(local.summary.enrollables, 279);
  assert.equal(local.sourceVersion, 'sheet-v1');
  await assert.rejects(() => runJob({ type: 'catalog', payload: { operation: 'requestAnyUrl' } }, sync), error => error.code === 'AGENT_CATALOG_OPERATION_NOT_ALLOWED');
  await assert.rejects(() => runJob({ type: 'shell' }, sync), error => error.code === 'AGENT_JOB_NOT_ALLOWED');
});

test('logs redact secret-shaped fields and rotate safely', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-log-'));
  const logger = new Logger(directory, { maxBytes: 80, keep: 2 });
  logger.info('test', { hostname: 'PC', password: 'never-log-this', token: 'never-log-this' });
  logger.info('test2', { hostname: 'PC2' });
  const combined = fs.readdirSync(directory).map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('');
  assert.equal(combined.includes('never-log-this'), false);
});

test('error classification marks transport failures but not credential rejection', () => {
  assert.equal(publicError({ code: 'ETIMEDOUT', message: 'timeout' }).infrastructure, true);
  assert.equal(publicError({ code: 'PENTAGRAMA_SESSION_EXPIRED', message: 'bad credentials' }).infrastructure, false);
});


test('public bridge status exposes diagnostics without credentials or cookies', () => {
  const status = publicBridgeStatus({
    status: () => ({
      configured: true,
      browserTransportOnline: true,
      hasAuth: true,
      needsSession: false,
      reason: null,
      updatedAt: '2026-10-14T23:00:00.000Z',
      browserTransportSeenAt: '2026-10-14T23:00:01.000Z',
      login: 'must-not-leak',
      password: 'must-not-leak',
      cookies: [{ name: '.ASPXAUTH', value: 'secret' }]
    })
  });
  assert.equal(status.configured, true);
  assert.equal(status.browserTransportOnline, true);
  assert.equal(status.sessionReady, true);
  assert.equal(status.needsSession, false);
  assert.equal('login' in status, false);
  assert.equal('password' in status, false);
  assert.equal('cookies' in status, false);
});


test('read-only self probe retries errors quickly and refreshes healthy sessions every five minutes', () => {
  const now = Date.parse('2026-10-15T01:30:00.000Z');
  assert.equal(shouldSelfProbe({ status: 'unknown', checkedAt: null }, { browserTransportOnline: true }, now), true);
  assert.equal(shouldSelfProbe({ status: 'unknown', checkedAt: null }, { browserTransportOnline: false }, now), false);
  assert.equal(shouldSelfProbe(
    { status: 'ready', checkedAt: '2026-10-15T01:29:00.000Z' },
    { browserTransportOnline: true },
    now
  ), false);
  assert.equal(shouldSelfProbe(
    { status: 'ready', checkedAt: '2026-10-15T01:20:00.000Z' },
    { browserTransportOnline: true },
    now
  ), true);
  assert.equal(shouldSelfProbe(
    { status: 'error', checkedAt: '2026-10-15T01:29:45.000Z' },
    { browserTransportOnline: true },
    now
  ), false);
  assert.equal(shouldSelfProbe(
    { status: 'error', checkedAt: '2026-10-15T01:29:20.000Z' },
    { browserTransportOnline: true },
    now
  ), true);
});
