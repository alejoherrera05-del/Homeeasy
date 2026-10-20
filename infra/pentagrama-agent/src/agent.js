'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentApi } = require('./api');
const { Logger } = require('./logger');
const dpapi = require('./dpapi');
const { PentagramaSessionBridge } = require('./session-bridge');
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
const HEALTH_PATH = String(process.env.HOMEEASY_AGENT_HEALTH_FILE || path.join(ROOT, 'runtime-health.json'));
const logger = new Logger(path.join(ROOT, 'logs'));
let stopping = false;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 });
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function writeRuntimeHealth(runtime = {}) {
  try {
    fs.mkdirSync(path.dirname(HEALTH_PATH), { recursive: true });
    const temporary = `${HEALTH_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({
      pid: process.pid,
      version: VERSION,
      updatedAt: new Date().toISOString(),
      ...runtime
    }), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, HEALTH_PATH);
  } catch (error) {
    logger.warn('runtime_health_write_failed', { code: error.code || 'HEALTH_WRITE_FAILED' });
  }
}

function startJobHeartbeat(job, sendHeartbeat, options = {}) {
  const intervalMs = Math.max(1000, Number(options.intervalMs || 10000));
  const startedAt = new Date().toISOString();
  const runtime = {
    status: 'running',
    processId: process.pid,
    jobId: String(job && job.id || ''),
    jobType: String(job && job.type || ''),
    phase: 'EXECUTING',
    startedAt,
    updatedAt: startedAt
  };
  let active = true;
  let timer = null;
  const schedule = () => {
    if (!active) return;
    timer = setTimeout(async () => {
      runtime.updatedAt = new Date().toISOString();
      writeRuntimeHealth(runtime);
      try {
        await sendHeartbeat({ ...runtime });
      } catch (error) {
        logger.warn('job_heartbeat_failed', {
          jobId: runtime.jobId,
          type: runtime.jobType,
          code: error.code || 'AGENT_TRANSPORT_ERROR'
        });
      } finally {
        schedule();
      }
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  };
  writeRuntimeHealth(runtime);
  schedule();
  return {
    runtime,
    stop(phase = 'IDLE') {
      active = false;
      if (timer) clearTimeout(timer);
      writeRuntimeHealth({ status: 'idle', phase, jobId: '', jobType: '' });
    }
  };
}

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
  const result = {
    code,
    message: String(error && error.message || 'Agent job failed').slice(0, 300),
    infrastructure: ['PENTAGRAMA_ACCESS_BLOCKED', 'PENTAGRAMA_UNEXPECTED_RESPONSE', 'PENTAGRAMA_BROWSER_SESSION_REQUIRED', 'AGENT_TRANSPORT_ERROR', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(code)
  };
  if (code.startsWith('PENTAGRAMA_LOCAL_MODEL_')) {
    if (Array.isArray(error && error.failures)) result.failures = error.failures.slice(0, 50);
    if (Array.isArray(error && error.missing)) result.missing = error.missing.slice(0, 300);
  }
  return result;
}

const CATALOG_OPERATIONS = Object.freeze({
  categories: 'categories', products: 'products', attributes: 'attributes', defaults: 'defaults',
  dependencies: 'dependencies', alerts: 'alerts', validateRoller: 'validateRoller', fixedPrice: 'fixedPrice'
});

async function runJob(job, sync) {
  if (!job || !['health', 'getPrice', 'catalog', 'resolveLivePrice', 'catalogInventory', 'buildLocalEnrollablesSnapshot'].includes(job.type)) throw Object.assign(new Error('Job type is not allowed'), { code: 'AGENT_JOB_NOT_ALLOWED' });
  if (job.type === 'health') {
    await sync.client.get('/Order/GetJsonCategoryList', { level: 1 });
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
  if (job.type === 'catalogInventory') return sync.catalogInventory.scan();
  if (job.type === 'buildLocalEnrollablesSnapshot') {
    return sync.localModel.build(payload.source || {});
  }
  return sync.pricing.supplierCost(payload.params || {}, payload.options || {});
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const config = readJson(CONFIG_PATH);
  const agentIdentity = identity();
  const api = new AgentApi({ serverUrl: config.serverUrl, caPath: path.resolve(path.dirname(CONFIG_PATH), config.caFile || 'server.crt') });
  const secrets = await provision(api, agentIdentity);
  const sessionBridge = new PentagramaSessionBridge({
    extensionId: 'cmijhfckibhbdhneapoknlbmfadfmogn',
    login: secrets.pentagrama.login,
    password: secrets.pentagrama.password,
    baseUrl: secrets.pentagrama.baseUrl
  });
  await sessionBridge.start();

  const sync = createPentagramaSync({
    login: secrets.pentagrama.login,
    password: secrets.pentagrama.password,
    baseUrl: secrets.pentagrama.baseUrl,
    browserTransport: request => sessionBridge.browserRequest(request, Math.max(150000, Number(request && request.timeoutMs || 0)))
  });
  const headers = authHeaders(agentIdentity, secrets);
  let pentagrama = { status: 'unknown', checkedAt: null };
  let runtime = { status: 'idle', phase: 'STARTED', updatedAt: new Date().toISOString() };
  let failures = 0;
  let announcedUpdate = '';
  let pendingResult = null;
  logger.info('started', { version: VERSION, installationId: agentIdentity.installationId, hostname: agentIdentity.hostname });
  writeRuntimeHealth(runtime);

  while (!stopping) {
    try {
      if (pendingResult) {
        const acknowledgment = await api.post('/api/pentagrama-agent/result', pendingResult.body, headers);
        if (acknowledgment && acknowledgment.late) {
          logger.warn('job_result_late', {
            jobId: pendingResult.body.jobId,
            type: pendingResult.type,
            durationMs: Date.now() - pendingResult.started
          });
        }
        logger[pendingResult.body.ok ? 'info' : 'warn'](pendingResult.body.ok ? 'job_completed' : 'job_failed', {
          jobId: pendingResult.body.jobId,
          type: pendingResult.type,
          code: pendingResult.body.error && pendingResult.body.error.code,
          durationMs: Date.now() - pendingResult.started
        });
        pendingResult = null;
      }
      runtime = { status: 'idle', phase: 'POLLING', updatedAt: new Date().toISOString() };
      writeRuntimeHealth(runtime);
      const heartbeat = await api.post('/api/pentagrama-agent/heartbeat', { ...agentIdentity, version: VERSION, pentagrama, runtime }, headers);
      if (heartbeat.updateAvailable && announcedUpdate !== String(heartbeat.latestVersion || '')) {
        announcedUpdate = String(heartbeat.latestVersion || '');
        logger.warn('update_available', { currentVersion: VERSION, latestVersion: heartbeat.latestVersion });
      }
      const delivery = await api.post('/api/pentagrama-agent/poll', { ...agentIdentity, version: VERSION, pentagrama, runtime }, headers);
      failures = 0;
      if (!delivery.job) continue;
      const started = Date.now();
      const jobHeartbeat = startJobHeartbeat(delivery.job, currentRuntime =>
        api.post('/api/pentagrama-agent/heartbeat', {
          ...agentIdentity,
          version: VERSION,
          pentagrama,
          runtime: currentRuntime
        }, headers));
      runtime = jobHeartbeat.runtime;
      logger.info('job_started', { jobId: delivery.job.id, type: delivery.job.type, phase: runtime.phase });
      let outcome;
      try {
        const result = await runJob(delivery.job, sync);
        pentagrama = { status: 'ready', checkedAt: new Date().toISOString() };
        outcome = { jobId: delivery.job.id, ok: true, result, pentagrama };
      } catch (error) {
        const safeError = publicError(error);
        pentagrama = { status: 'error', checkedAt: new Date().toISOString(), code: safeError.code };
        outcome = { jobId: delivery.job.id, ok: false, error: safeError, pentagrama };
      }
      jobHeartbeat.stop(outcome.ok ? 'COMPLETED' : 'FAILED');
      runtime = { status: 'idle', phase: outcome.ok ? 'COMPLETED' : 'FAILED', updatedAt: new Date().toISOString() };
      pendingResult = { body: outcome, type: delivery.job.type, started };
    } catch (error) {
      failures += 1;
      runtime = { status: 'recovering', phase: 'CONNECTION_RETRY', updatedAt: new Date().toISOString(), code: String(error.code || 'AGENT_TRANSPORT_ERROR') };
      writeRuntimeHealth(runtime);
      logger.warn('connection_retry', { code: error.code || 'AGENT_TRANSPORT_ERROR', attempt: failures });
      await delay(Math.min(60000, 1000 * (2 ** Math.min(failures, 6))));
    }
  }
  await sessionBridge.stop().catch(() => {});
  logger.info('stopped');
}

process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
process.on('uncaughtException', error => { logger.error('uncaught_exception', { code: error.code || 'UNCAUGHT', message: error.message }); process.exit(1); });
process.on('unhandledRejection', error => { logger.error('unhandled_rejection', { code: error && error.code || 'UNHANDLED', message: error && error.message }); process.exit(1); });

if (require.main === module) {
  main().catch(error => { logger.error('startup_failed', { code: error.code || 'STARTUP_FAILED', message: error.message }); process.exit(1); });
}

module.exports = Object.freeze({ identity, decryptEnvelope, publicError, runJob, startJobHeartbeat, writeRuntimeHealth, CATALOG_OPERATIONS });
