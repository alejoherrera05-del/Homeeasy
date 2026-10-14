'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PentagramaAgentGateway } = require('./gateway');

function fixture(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-gateway-'));
  return new PentagramaAgentGateway({
    dataDir,
    bootstrapToken: 'bootstrap-test',
    login: 'account@example.test',
    password: 'secret-test',
    pollTimeoutMs: 50,
    jobTimeoutMs: 1000,
    ...options
  });
}

function register(gateway, id = crypto.randomUUID(), version = '1.5.3') {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const body = gateway.register('bootstrap-test', {
    identity: { installationId: id, hostname: 'TEST-PC', version, platform: 'win32-x64', installedAt: new Date().toISOString() },
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' })
  });
  const contentKey = crypto.privateDecrypt({ key: keys.privateKey, oaepHash: 'sha256' }, Buffer.from(body.sealed.key, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(body.sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(body.sealed.tag, 'base64'));
  const secrets = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body.sealed.data, 'base64')), decipher.final()]));
  return { id, token: secrets.agentToken, secrets };
}

test('registration returns only an encrypted credential envelope and stores token hash', () => {
  const gateway = fixture();
  const registration = register(gateway);
  assert.equal(registration.secrets.pentagrama.login, 'account@example.test');
  assert.equal(registration.secrets.pentagrama.password, 'secret-test');
  const saved = fs.readFileSync(gateway.file, 'utf8');
  assert.equal(saved.includes('secret-test'), false);
  assert.equal(saved.includes(registration.token), false);
  assert.equal(gateway.list()[0].online, true);
});

test('heartbeat does not enqueue a Pentagrama login job', async () => {
  const gateway = fixture();
  const registration = register(gateway);
  const agent = gateway.authenticate(registration.id, registration.token);
  gateway.heartbeat(agent, { version: '1.0.0', pentagrama: { status: 'ready', checkedAt: null } });
  const poll = await gateway.poll(agent);
  assert.equal(poll.job, null);
});

test('dispatcher sends only allowlisted work and returns price, catalog or live resolver results', async () => {
  const gateway = fixture();
  const registration = register(gateway, crypto.randomUUID(), '1.5.3');
  const agent = gateway.authenticate(registration.id, registration.token);
  const pending = gateway.dispatch('getPrice', { params: { ProductCode: 'TEST' } });
  const delivery = await gateway.poll(agent);
  assert.equal(delivery.job.type, 'getPrice');
  gateway.complete(agent, { jobId: delivery.job.id, ok: true, result: { basePrice: 244800, total: 244800 } });
  assert.equal((await pending).basePrice, 244800);
  const catalogPending = gateway.dispatch('catalog', { operation: 'categories' });
  const catalogDelivery = await gateway.poll(agent);
  assert.equal(catalogDelivery.job.type, 'catalog');
  gateway.complete(agent, { jobId: catalogDelivery.job.id, ok: true, result: [{ id: 1 }] });
  assert.deepEqual(await catalogPending, [{ id: 1 }]);
  const livePending = gateway.dispatch('resolveLivePrice', { homeeasyId: 'matte3' });
  const liveDelivery = await gateway.poll(agent);
  assert.equal(liveDelivery.job.type, 'resolveLivePrice');
  gateway.complete(agent, { jobId: liveDelivery.job.id, ok: true, result: { ok: true, outcome: 'PRICE' } });
  assert.equal((await livePending).outcome, 'PRICE');
  const localPending = gateway.dispatch('buildLocalEnrollablesSnapshot', { source: { products: [] } });
  const localDelivery = await gateway.poll(agent);
  assert.equal(localDelivery.job.type, 'buildLocalEnrollablesSnapshot');
  gateway.complete(agent, { jobId: localDelivery.job.id, ok: true, result: { products: [] } });
  assert.equal((await localPending).products.length, 0);
  await assert.rejects(() => gateway.dispatch('shell', {}), error => error.code === 'AGENT_JOB_NOT_ALLOWED');
});

test('local snapshot jobs use the dedicated long-running timeout', async () => {
  const gateway = fixture({ localModelJobTimeoutMs: 75 * 60 * 1000 });
  const registration = register(gateway, crypto.randomUUID(), '1.5.3');
  gateway.authenticate(registration.id, registration.token);
  let observedTimeout = null;
  gateway.runOnAgent = async (_agent, type, _payload, timeoutMs) => {
    assert.equal(type, 'buildLocalEnrollablesSnapshot');
    observedTimeout = timeoutMs;
    return { ok: true };
  };
  assert.equal((await gateway.dispatch('buildLocalEnrollablesSnapshot', {})).ok, true);
  assert.equal(observedTimeout, 75 * 60 * 1000);
});

test('local snapshot jobs skip legacy agents that cannot execute the model builder', async () => {
  const gateway = fixture();
  register(gateway, crypto.randomUUID(), '1.2.1');
  const current = register(gateway, crypto.randomUUID(), '1.5.3');
  const agent = gateway.authenticate(current.id, current.token);
  const pending = gateway.dispatch('buildLocalEnrollablesSnapshot', {});
  const delivery = await gateway.poll(agent);
  assert.equal(delivery.job.type, 'buildLocalEnrollablesSnapshot');
  gateway.complete(agent, { jobId: delivery.job.id, ok: true, result: { ok: true } });
  assert.equal((await pending).ok, true);
});

test('dispatcher excludes pre-1.5.3 agents and prefers the newest ready compatible agent', async () => {
  const gateway = fixture();
  const legacy = register(gateway, crypto.randomUUID(), '1.5.1');
  const current = register(gateway, crypto.randomUUID(), '1.5.3');
  const newer = register(gateway, crypto.randomUUID(), '1.5.3');

  const legacyAgent = gateway.authenticate(legacy.id, legacy.token);
  const currentAgent = gateway.authenticate(current.id, current.token);
  const newerAgent = gateway.authenticate(newer.id, newer.token);

  gateway.heartbeat(legacyAgent, { version: '1.5.2', pentagrama: { status: 'ready' } });
  gateway.heartbeat(currentAgent, { version: '1.5.3', pentagrama: { status: 'ready' } });
  gateway.heartbeat(newerAgent, { version: '1.5.4', pentagrama: { status: 'ready' } });

  const pending = gateway.dispatch('catalog', { operation: 'categories' });

  const legacyPoll = await gateway.poll(legacyAgent);
  assert.equal(legacyPoll.job, null);

  const currentPoll = await gateway.poll(currentAgent);
  assert.equal(currentPoll.job, null);

  const newerPoll = await gateway.poll(newerAgent);
  assert.equal(newerPoll.job.type, 'catalog');
  gateway.complete(newerAgent, { jobId: newerPoll.job.id, ok: true, result: [{ id: 1 }] });

  assert.deepEqual(await pending, [{ id: 1 }]);
});

test('functional errors stop while infrastructure errors fail over once', async () => {
  const gateway = fixture();
  const first = register(gateway);
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = register(gateway);
  const functional = gateway.dispatch('health', {}, { lockKey: 'functional' });
  const job1 = await gateway.poll(gateway.authenticate(first.id, first.token));
  gateway.complete(gateway.authenticate(first.id, first.token), { jobId: job1.job.id, ok: false, error: { code: 'PENTAGRAMA_SESSION_EXPIRED', message: 'bad credentials' } });
  await assert.rejects(functional, error => error.code === 'PENTAGRAMA_SESSION_EXPIRED');

  const failover = gateway.dispatch('health', {}, { lockKey: 'infra' });
  const job2 = await gateway.poll(gateway.authenticate(second.id, second.token));
  gateway.complete(gateway.authenticate(second.id, second.token), { jobId: job2.job.id, ok: false, error: { code: 'AGENT_TRANSPORT_ERROR', message: 'network', infrastructure: true } });
  const job3 = await gateway.poll(gateway.authenticate(first.id, first.token));
  gateway.complete(gateway.authenticate(first.id, first.token), { jobId: job3.job.id, ok: true, result: { ok: true } });
  assert.equal((await failover).ok, true);
});
