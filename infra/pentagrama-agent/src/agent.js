'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentApi } = require('./api');
const { Logger } = require('./logger');
const dpapi = require('./dpapi');
let createPentagramaSync;
try {
  ({ createPentagramaSync } = require('../core'));
} catch (_) {
  ({ createPentagramaSync } = require('../../whatsapp/bridge/pentagrama-sync'));
}
const packageJson = require('../package.json');

const VERSION = packageJson.version;
const ROOT = String(process.env.HOMEEASY_AGENT_DATA || path.join(process.env.ProgramData || 'C:\\ProgramData', 'HomeEasy', 'PentagramaAgent'));
const CONFIG_PATH = String(process.env.HOMEEASY_AGENT_CONFIG || path.join(__dirname, '..', 'config.json'));
const IDENTITY_PATH = path.join(ROOT, 'installation.json');
const PRIVATE_KEY_PATH = path.join(ROOT, 'private-key.dpapi');
const SECRETS_PATH = path.join(ROOT, 'secrets.dpapi');
const ENROLLMENT_PATH = path.join(__dirname, '..', 'enrollment.key');
const logger = new Logger(path.join(ROOT, 'logs'));
let stopping = false;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 });
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function identity() {
  try { return readJson(IDENTITY_PATH); } catch (_) {}
  const value = {
    installationId: crypto.randomUUID(),
    hostname: os.hostname(),
    version: VERSION,
    platform: `${process.platform}-${process.arch}-${os.release()}`,
    installedAt: new Date().toISOString()
  };
  writePrivate(IDENTITY_PATH, JSON.stringify(value, null, 2));
  return value;
}

function decryptEnvelope(sealed, privateKey) {
  const contentKey = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(sealed.key, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]));
}

async function provision(api, agentIdentity) {
  if (fs.existsSync(SECRETS_PATH)) {
    try { fs.rmSync(ENROLLMENT_PATH, { force: true }); } catch (_) {}
    return JSON.parse(await dpapi.unprotect(fs.readFileSync(SECRETS_PATH, 'utf8')));
  }
  if (!fs.existsSync(ENROLLMENT_PATH)) throw Object.assign(new Error('Agent is not provisioned and enrollment key is unavailable'), { code: 'AGENT_NOT_PROVISIONED' });
  let privateKey;
  let publicKey;
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    privateKey = await dpapi.unprotect(fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'));
    publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  } else {
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
    writePrivate(PRIVATE_KEY_PATH, await dpapi.protect(privateKey));
  }
  const enrollmentToken = fs.readFileSync(ENROLLMENT_PATH, 'utf8').trim();
  const response = await api.post('/api/pentagrama-agent/register', { identity: agentIdentity, publicKey }, { 'X-HomeEasy-Enrollment': enrollmentToken });
  const secrets = decryptEnvelope(response.sealed, privateKey);
  writePrivate(SECRETS_PATH, await dpapi.protect(JSON.stringify(secrets)));
  try { fs.rmSync(ENROLLMENT_PATH, { force: true }); } catch (_) {}
  try { fs.rmSync(PRIVATE_KEY_PATH, { force: true }); } catch (_) {}
  logger.info('provisioned', { installationId: agentIdentity.installationId });
  return secrets;
}

function authHeaders(agentIdentity, secrets) {
  return {
    Authorization: `Bearer ${secrets.agentToken}`,
    'X-HomeEasy-Installation-Id': agentIdentity.installationId
  };
}

function publicError(error) {
  const code = String(error && error.code || 'AGENT_JOB_FAILED');
  return {
    code,
    message: String(error && error.message || 'Agent job failed').slice(0, 300),
    infrastructure: ['PENTAGRAMA_ACCESS_BLOCKED', 'PENTAGRAMA_UNEXPECTED_RESPONSE', 'AGENT_TRANSPORT_ERROR', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(code)
  };
}

const CATALOG_OPERATIONS = Object.freeze({
  categories: 'categories', products: 'products', attributes: 'attributes', defaults: 'defaults',
  dependencies: 'dependencies', alerts: 'alerts', validateRoller: 'validateRoller', fixedPrice: 'fixedPrice'
});

async function runJob(job, sync) {
  if (!job || !['health', 'getPrice', 'catalog', 'resolveLivePrice'].includes(job.type)) throw Object.assign(new Error('Job type is not allowed'), { code: 'AGENT_JOB_NOT_ALLOWED' });
  if (job.type === 'health') {
    await sync.client.get('/Order/GetJsonCategoryList');
    return { ok: true, checkedAt: new Date().toISOString() };
  }
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  if (job.type === 'catalog') {
    const method = CATALOG_OPERATIONS[String(payload.operation || '')];
    if (!method || !sync.catalog || typeof sync.catalog[method] !== 'function') {
      throw Object.assign(new Error('Catalog operation is not allowed'), { code: 'AGENT_CATALOG_OPERATION_NOT_ALLOWED' });
    }
    return sync.catalog[method](payload.params || {});
  }
  if (job.type === 'resolveLivePrice') return sync.liveResolver.resolve(payload);
  return sync.pricing.supplierCost(payload.params || {}, payload.options || {});
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const config = readJson(CONFIG_PATH);
  const agentIdentity = identity();
  const api = new AgentApi({ serverUrl: config.serverUrl, caPath: path.resolve(path.dirname(CONFIG_PATH), config.caFile || 'server.crt') });
  const secrets = await provision(api, agentIdentity);
  const sync = createPentagramaSync({
    login: secrets.pentagrama.login,
    password: secrets.pentagrama.password,
    baseUrl: secrets.pentagrama.baseUrl
  });
  const headers = authHeaders(agentIdentity, secrets);
  let pentagrama = { status: 'unknown', checkedAt: null };
  let failures = 0;
  logger.info('started', { version: VERSION, installationId: agentIdentity.installationId, hostname: agentIdentity.hostname });

  while (!stopping) {
    try {
      const heartbeat = await api.post('/api/pentagrama-agent/heartbeat', { ...agentIdentity, version: VERSION, pentagrama }, headers);
      if (heartbeat.updateAvailable) logger.warn('update_available', { currentVersion: VERSION, latestVersion: heartbeat.latestVersion });
      const delivery = await api.post('/api/pentagrama-agent/poll', { ...agentIdentity, version: VERSION, pentagrama }, headers);
      failures = 0;
      if (!delivery.job) continue;
      const started = Date.now();
      try {
        const result = await runJob(delivery.job, sync);
        pentagrama = { status: 'ready', checkedAt: new Date().toISOString() };
        await api.post('/api/pentagrama-agent/result', { jobId: delivery.job.id, ok: true, result, pentagrama }, headers);
        logger.info('job_completed', { jobId: delivery.job.id, type: delivery.job.type, durationMs: Date.now() - started });
      } catch (error) {
        const safeError = publicError(error);
        pentagrama = { status: 'error', checkedAt: new Date().toISOString(), code: safeError.code };
        await api.post('/api/pentagrama-agent/result', { jobId: delivery.job.id, ok: false, error: safeError, pentagrama }, headers);
        logger.warn('job_failed', { jobId: delivery.job.id, type: delivery.job.type, code: safeError.code, durationMs: Date.now() - started });
      }
    } catch (error) {
      failures += 1;
      logger.warn('connection_retry', { code: error.code || 'AGENT_TRANSPORT_ERROR', attempt: failures });
      await delay(Math.min(60000, 1000 * (2 ** Math.min(failures, 6))));
    }
  }
  logger.info('stopped');
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
process.on('uncaughtException', error => { logger.error('uncaught_exception', { code: error.code || 'UNCAUGHT', message: error.message }); process.exit(1); });
process.on('unhandledRejection', error => { logger.error('unhandled_rejection', { code: error && error.code || 'UNHANDLED', message: error && error.message }); process.exit(1); });

if (require.main === module) {
  main().catch(error => { logger.error('startup_failed', { code: error.code || 'STARTUP_FAILED', message: error.message }); process.exit(1); });
}

module.exports = Object.freeze({ identity, decryptEnvelope, publicError, runJob, CATALOG_OPERATIONS });
