'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALLOWED_JOBS = new Set(['health', 'getPrice', 'catalog']);
const INFRASTRUCTURE_CODES = new Set([
  'AGENT_OFFLINE',
  'AGENT_TIMEOUT',
  'AGENT_TRANSPORT_ERROR',
  'PENTAGRAMA_ACCESS_BLOCKED',
  'PENTAGRAMA_UNEXPECTED_RESPONSE'
]);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function publicAgent(agent, now = Date.now(), onlineMs = 45000) {
  const lastSeenMs = Date.parse(agent.lastSeen || '') || 0;
  return {
    installationId: agent.installationId,
    hostname: agent.hostname,
    version: agent.version,
    platform: agent.platform,
    installedAt: agent.installedAt,
    registeredAt: agent.registeredAt,
    lastSeen: agent.lastSeen,
    online: now - lastSeenMs <= onlineMs,
    lastJob: agent.lastJob || null,
    pentagrama: agent.pentagrama || { status: 'unknown' }
  };
}

class PentagramaAgentGateway {
  constructor(options = {}) {
    this.dataDir = String(options.dataDir || process.env.DATA_DIR || '/app/data');
    this.file = path.join(this.dataDir, 'pentagrama-agents.json');
    this.bootstrapToken = String(options.bootstrapToken || process.env.PENTAGRAMA_AGENT_BOOTSTRAP_TOKEN || '');
    this.login = String(options.login || process.env.PENTAGRAMA_LOGIN || '');
    this.password = String(options.password || process.env.PENTAGRAMA_PASSWORD || '');
    this.baseUrl = String(options.baseUrl || process.env.PENTAGRAMA_BASE_URL || 'https://pedidos.persianaspentagrama.com');
    this.onlineMs = Math.max(15000, Number(options.onlineMs || 45000));
    this.jobTimeoutMs = Math.max(5000, Number(options.jobTimeoutMs || 45000));
    this.pollTimeoutMs = Math.max(5000, Number(options.pollTimeoutMs || 25000));
    this.latestVersion = String(options.latestVersion || process.env.PENTAGRAMA_AGENT_LATEST_VERSION || '1.0.0');
    this.agents = new Map();
    this.jobs = new Map();
    this.pendingPolls = new Map();
    this.locks = new Map();
    this.load();
  }

  configured() {
    return Boolean(this.bootstrapToken && this.login && this.password);
  }

  load() {
    try {
      const values = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const agent of Array.isArray(values) ? values : []) {
        if (agent && agent.installationId && agent.tokenHash) this.agents.set(agent.installationId, agent);
      }
    } catch (_) {}
  }

  persist() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Array.from(this.agents.values()), null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  register(enrollmentToken, body) {
    if (!this.configured()) throw Object.assign(new Error('Pentagrama Agent registration is not configured'), { statusCode: 503, code: 'AGENT_NOT_CONFIGURED' });
    if (!safeEqual(enrollmentToken, this.bootstrapToken)) throw Object.assign(new Error('Agent enrollment rejected'), { statusCode: 401, code: 'AGENT_ENROLLMENT_REJECTED' });
    const identity = body && body.identity || {};
    const installationId = String(identity.installationId || '').trim();
    const publicKey = String(body && body.publicKey || '');
    if (!/^[0-9a-f-]{36}$/i.test(installationId) || !publicKey.includes('BEGIN PUBLIC KEY')) {
      throw Object.assign(new Error('Invalid agent registration payload'), { statusCode: 400, code: 'AGENT_INVALID_REGISTRATION' });
    }
    const agentToken = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const previous = this.agents.get(installationId);
    const agent = {
      installationId,
      hostname: String(identity.hostname || '').slice(0, 120),
      version: String(identity.version || '').slice(0, 40),
      platform: String(identity.platform || '').slice(0, 80),
      installedAt: String(identity.installedAt || now),
      registeredAt: previous && previous.registeredAt || now,
      lastSeen: now,
      tokenHash: sha256(agentToken),
      lastJob: previous && previous.lastJob || null,
      pentagrama: { status: 'unknown', checkedAt: null }
    };
    this.agents.set(installationId, agent);
    this.persist();
    const secretPayload = Buffer.from(JSON.stringify({
      agentToken,
      pentagrama: { login: this.login, password: this.password, baseUrl: this.baseUrl }
    }));
    let sealed;
    try {
      const contentKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
      const data = Buffer.concat([cipher.update(secretPayload), cipher.final()]);
      sealed = {
        key: crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, contentKey).toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64')
      };
    } catch (_) {
      this.agents.delete(installationId);
      throw Object.assign(new Error('Agent public key was rejected'), { statusCode: 400, code: 'AGENT_INVALID_PUBLIC_KEY' });
    }
    return { ok: true, installationId, sealed, serverTime: now };
  }

  authenticate(installationId, token) {
    const agent = this.agents.get(String(installationId || ''));
    if (!agent || !safeEqual(agent.tokenHash, sha256(token))) {
      throw Object.assign(new Error('Agent authentication rejected'), { statusCode: 401, code: 'AGENT_AUTH_REJECTED' });
    }
    return agent;
  }

  heartbeat(agent, body = {}) {
    agent.lastSeen = new Date().toISOString();
    agent.hostname = String(body.hostname || agent.hostname || '').slice(0, 120);
    agent.version = String(body.version || agent.version || '').slice(0, 40);
    agent.platform = String(body.platform || agent.platform || '').slice(0, 80);
    if (body.pentagrama && typeof body.pentagrama === 'object') {
      agent.pentagrama = {
        status: String(body.pentagrama.status || 'unknown').slice(0, 60),
        checkedAt: body.pentagrama.checkedAt || null,
        code: body.pentagrama.code ? String(body.pentagrama.code).slice(0, 80) : undefined
      };
    }
    this.persist();
    return {
      ok: true,
      serverTime: agent.lastSeen,
      latestVersion: this.latestVersion,
      updateAvailable: Boolean(agent.version && agent.version !== this.latestVersion)
    };
  }

  list() {
    const now = Date.now();
    return Array.from(this.agents.values()).map(agent => publicAgent(agent, now, this.onlineMs));
  }

  takeJob(agent) {
    agent.lastSeen = new Date().toISOString();
    const job = Array.from(this.jobs.values()).find(item => item.agentId === agent.installationId && item.state === 'queued');
    if (!job) return null;
    job.state = 'running';
    job.startedAt = new Date().toISOString();
    agent.lastJob = { id: job.id, type: job.type, state: 'running', at: job.startedAt };
    this.persist();
    return { id: job.id, type: job.type, payload: job.payload, createdAt: job.createdAt };
  }

  poll(agent) {
    const immediate = this.takeJob(agent);
    if (immediate) return Promise.resolve({ ok: true, job: immediate });
    return new Promise(resolve => {
      const existing = this.pendingPolls.get(agent.installationId);
      if (existing) existing({ ok: true, job: null });
      let timer;
      const finish = value => {
        clearTimeout(timer);
        if (this.pendingPolls.get(agent.installationId) === finish) this.pendingPolls.delete(agent.installationId);
        resolve(value);
      };
      timer = setTimeout(() => finish({ ok: true, job: null }), this.pollTimeoutMs);
      this.pendingPolls.set(agent.installationId, finish);
    });
  }

  complete(agent, body) {
    const job = this.jobs.get(String(body && body.jobId || ''));
    if (!job || job.agentId !== agent.installationId) throw Object.assign(new Error('Unknown agent job'), { statusCode: 404, code: 'AGENT_JOB_NOT_FOUND' });
    if (!['running', 'queued'].includes(job.state)) return { ok: true, duplicate: true };
    job.state = body.ok === true ? 'completed' : 'failed';
    job.completedAt = new Date().toISOString();
    job.result = body.ok === true ? body.result : null;
    job.error = body.ok === true ? null : {
      code: String(body.error && body.error.code || 'AGENT_JOB_FAILED').slice(0, 100),
      message: String(body.error && body.error.message || 'Agent job failed').slice(0, 300),
      infrastructure: body.error && body.error.infrastructure === true
    };
    agent.lastSeen = job.completedAt;
    agent.lastJob = { id: job.id, type: job.type, state: job.state, at: job.completedAt };
    if (body.pentagrama) agent.pentagrama = body.pentagrama;
    this.persist();
    if (job.finish) job.finish(job);
    return { ok: true };
  }

  onlineAgents(excluded = new Set()) {
    const now = Date.now();
    return Array.from(this.agents.values())
      .filter(agent => !excluded.has(agent.installationId) && now - (Date.parse(agent.lastSeen || '') || 0) <= this.onlineMs)
      .sort((a, b) => (Date.parse(a.lastJob && a.lastJob.at || '') || 0) - (Date.parse(b.lastJob && b.lastJob.at || '') || 0));
  }

  runOnAgent(agent, type, payload) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const job = { id, agentId: agent.installationId, type, payload, state: 'queued', createdAt: new Date().toISOString() };
      let timer;
      job.finish = completed => {
        clearTimeout(timer);
        this.jobs.delete(id);
        if (completed.state === 'completed') return resolve(completed.result);
        const error = Object.assign(new Error(completed.error && completed.error.message || 'Agent job failed'), completed.error || {});
        reject(error);
      };
      this.jobs.set(id, job);
      const pending = this.pendingPolls.get(agent.installationId);
      if (pending) pending({ ok: true, job: this.takeJob(agent) });
      timer = setTimeout(() => {
        this.jobs.delete(id);
        reject(Object.assign(new Error('Pentagrama Agent timed out'), { code: 'AGENT_TIMEOUT', infrastructure: true }));
      }, this.jobTimeoutMs);
    });
  }

  async dispatch(type, payload = {}, options = {}) {
    if (!ALLOWED_JOBS.has(type)) throw Object.assign(new Error('Unsupported Pentagrama Agent job'), { statusCode: 400, code: 'AGENT_JOB_NOT_ALLOWED' });
    const lockKey = String(options.lockKey || `${type}:${sha256(JSON.stringify(payload))}`);
    if (this.locks.has(lockKey)) return this.locks.get(lockKey);
    const pending = this._dispatch(type, payload).finally(() => this.locks.delete(lockKey));
    this.locks.set(lockKey, pending);
    return pending;
  }

  async _dispatch(type, payload) {
    const excluded = new Set();
    let lastError;
    while (excluded.size < 2) {
      const agent = this.onlineAgents(excluded)[0];
      if (!agent) break;
      excluded.add(agent.installationId);
      try {
        return await this.runOnAgent(agent, type, payload);
      } catch (error) {
        lastError = error;
        const infrastructure = error.infrastructure === true || INFRASTRUCTURE_CODES.has(error.code);
        if (!infrastructure) throw error;
      }
    }
    if (lastError) throw Object.assign(lastError, { statusCode: 503 });
    throw Object.assign(new Error('No Pentagrama Agent is online'), { statusCode: 503, code: 'AGENT_OFFLINE', infrastructure: true });
  }
}

module.exports = Object.freeze({ PentagramaAgentGateway, ALLOWED_JOBS, INFRASTRUCTURE_CODES, publicAgent });
