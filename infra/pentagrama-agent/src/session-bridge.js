'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 38461;
const SESSION_COOKIE_NAMES = new Set(['.ASPXAUTH', 'ASP.NET_SessionId', 'cf_clearance']);

function normalizeCookies(value) {
  if (!Array.isArray(value)) return [];
  const byName = new Map();
  for (const cookie of value) {
    const name = String(cookie && cookie.name || '').trim();
    const cookieValue = String(cookie && cookie.value || '');
    if (!SESSION_COOKIE_NAMES.has(name) || !cookieValue) continue;
    byName.set(name, {
      name,
      value: cookieValue,
      domain: String(cookie.domain || ''),
      path: String(cookie.path || '/'),
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      expirationDate: Number.isFinite(Number(cookie.expirationDate)) ? Number(cookie.expirationDate) : undefined,
      storeId: cookie.storeId === undefined ? undefined : String(cookie.storeId)
    });
  }
  return Array.from(byName.values());
}

function hasAuth(cookies) {
  return Array.isArray(cookies) && cookies.some(cookie => cookie.name === '.ASPXAUTH' && cookie.value);
}

function readBody(req, maxBytes = 32768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Session bridge request is too large'), { code: 'SESSION_BRIDGE_REQUEST_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(Object.assign(new Error('Session bridge request is invalid JSON'), { code: 'SESSION_BRIDGE_INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

function json(res, statusCode, payload, origin) {
  const body = Buffer.from(JSON.stringify(payload || {}));
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.end(body);
}

function extensionIdFromPublicKey(key) {
  const crypto = require('crypto');
  const digest = crypto.createHash('sha256').update(Buffer.from(String(key || ''), 'base64')).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  let id = '';
  for (const byte of digest) id += alphabet[byte >> 4] + alphabet[byte & 15];
  return id;
}

class PentagramaSessionBridge {
  constructor(options = {}) {
    this.host = String(options.host || '127.0.0.1');
    this.port = Number(options.port === undefined ? (process.env.PENTAGRAMA_SESSION_BRIDGE_PORT || DEFAULT_PORT) : options.port);
    const configuredIds = Array.isArray(options.extensionIds) ? options.extensionIds : [options.extensionId || process.env.PENTAGRAMA_SESSION_BRIDGE_EXTENSION_ID || ''];
    this.extensionIds = Array.from(new Set(configuredIds.map(value => String(value || '').trim()).filter(Boolean)));
    this.extensionId = this.extensionIds[0] || '';
    this.allowedOrigins = new Set(this.extensionIds.map(id => `chrome-extension://${id}`));
    this.extensionPackagePath = String(options.extensionPackagePath || '').trim();
    this.extensionVersion = String(options.extensionVersion || '1.0.0').trim();
    this.browserStatusPath = String(options.browserStatusPath || '').trim();
    this.login = String(options.login || '');
    this.password = String(options.password || '');
    this.baseUrl = String(options.baseUrl || 'https://pedidos.persianaspentagrama.com').replace(/\/$/, '');
    this.cookies = [];
    this.updatedAt = null;
    this.browser = null;
    this.needsSession = true;
    this.loginRequested = false;
    this.reason = 'STARTUP';
    this.server = null;
    this.waiters = new Set();
    this.browserQueue = [];
    this.browserPending = new Map();
    this.browserPollWaiters = new Set();
    this.browserOnlineAt = null;
  }

  configured() {
    return Boolean(this.allowedOrigins.size && this.login && this.password);
  }

  status() {
    return {
      ok: true,
      configured: this.configured(),
      needsSession: this.needsSession || !hasAuth(this.cookies),
      loginRequested: this.loginRequested,
      hasAuth: hasAuth(this.cookies),
      updatedAt: this.updatedAt,
      browser: this.browser,
      reason: this.reason,
      browserTransportOnline: Boolean(this.browserOnlineAt && (Date.now() - Date.parse(this.browserOnlineAt)) < 45000),
      browserTransportSeenAt: this.browserOnlineAt
    };
  }

  _allowed(req) {
    const origin = String(req.headers.origin || '').trim();
    const marker = String(req.headers['x-homeeasy-session-bridge'] || '').trim();

    // Manifest V3 service workers can issue localhost fetches without an Origin
    // header. Browser pages normally include Origin and are still restricted to
    // the known HomeEasy extension origin. The custom marker forces a CORS
    // preflight for ordinary web pages, so originless extension-worker calls can
    // be accepted without opening the endpoint to arbitrary sites.
    const originAllowed = !origin || this.allowedOrigins.has(origin);
    return Boolean(this.allowedOrigins.size && originAllowed && marker === '1');
  }

  _writeBrowserStatus(extra = {}) {
    if (!this.browserStatusPath) return;
    try {
      fs.mkdirSync(path.dirname(this.browserStatusPath), { recursive: true });
      const temporary = `${this.browserStatusPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({
        connected: Boolean(this.browserOnlineAt && (Date.now() - Date.parse(this.browserOnlineAt)) < 45000),
        browser: this.browser,
        extensionId: this.extensionId,
        updatedAt: new Date().toISOString(),
        ...extra
      }), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.browserStatusPath);
    } catch (_) {}
  }

  _wake() {
    for (const finish of Array.from(this.waiters)) finish();
    this.waiters.clear();
  }

  _wakeBrowserPoll() {
    for (const finish of Array.from(this.browserPollWaiters)) finish();
    this.browserPollWaiters.clear();
  }

  async browserRequest(payload = {}, timeoutMs = 60000) {
    const id = require('crypto').randomUUID();
    const deadlineMs = Math.max(5000, Math.min(240000, Number(timeoutMs || 60000)));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.browserPending.delete(id);
        reject(Object.assign(new Error('Pentagrama browser transport timed out'), {
          code: 'PENTAGRAMA_BROWSER_SESSION_REQUIRED',
          infrastructure: true
        }));
      }, deadlineMs);
      this.browserPending.set(id, {
        resolve: value => { clearTimeout(timer); this.browserPending.delete(id); resolve(value); },
        reject: error => { clearTimeout(timer); this.browserPending.delete(id); reject(error); }
      });
      this.browserQueue.push({ id, payload, createdAt: new Date().toISOString() });
      this._wakeBrowserPoll();
    });
  }

  async nextBrowserRequest(waitMs = 25000) {
    this.browserOnlineAt = new Date().toISOString();
    this._writeBrowserStatus({ connected: true, seenAt: this.browserOnlineAt });
    if (this.browserQueue.length) return this.browserQueue.shift();
    const timeout = Math.max(1000, Math.min(30000, Number(waitMs || 25000)));
    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.browserPollWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeout);
      this.browserPollWaiters.add(finish);
    });
    this.browserOnlineAt = new Date().toISOString();
    this._writeBrowserStatus({ connected: true, seenAt: this.browserOnlineAt });
    return this.browserQueue.length ? this.browserQueue.shift() : null;
  }

  resolveBrowserRequest(id, payload = {}) {
    this.browserOnlineAt = new Date().toISOString();
    this._writeBrowserStatus({ connected: true, seenAt: this.browserOnlineAt });
    const pending = this.browserPending.get(String(id || ''));
    if (!pending) return false;
    if (payload && payload.ok === false) {
      pending.reject(Object.assign(new Error(String(payload.error || 'Pentagrama browser request failed')), {
        code: String(payload.code || 'PENTAGRAMA_BROWSER_REQUEST_FAILED'),
        infrastructure: Boolean(payload.infrastructure)
      }));
      return true;
    }
    pending.resolve(payload && payload.result ? payload.result : payload);
    return true;
  }

  updateSession(payload = {}) {
    const cookies = normalizeCookies(payload.cookies);
    if (!hasAuth(cookies)) {
      throw Object.assign(new Error('Pentagrama session does not include .ASPXAUTH'), { code: 'PENTAGRAMA_BROWSER_SESSION_INVALID' });
    }
    this.cookies = cookies;
    this.updatedAt = new Date().toISOString();
    this.browser = payload.browser ? String(payload.browser).slice(0, 120) : null;
    this.browserOnlineAt = new Date().toISOString();
    this.needsSession = false;
    this.loginRequested = false;
    this.reason = null;
    this._writeBrowserStatus({ connected: true, seenAt: this.browserOnlineAt, sessionUpdatedAt: this.updatedAt });
    this._wake();
    return this.status();
  }

  invalidate(reason = 'SESSION_EXPIRED') {
    this.cookies = [];
    this.updatedAt = null;
    this.needsSession = true;
    this.loginRequested = false;
    this.reason = String(reason || 'SESSION_EXPIRED').slice(0, 120);
  }

  async session(options = {}) {
    const timeoutMs = Math.max(0, Math.min(60000, Number(options.timeoutMs || 45000)));
    if (hasAuth(this.cookies) && !this.needsSession) return { cookies: this.cookies.slice(), source: 'browser-session-bridge' };

    this.needsSession = true;
    this.loginRequested = true;
    this.reason = 'SESSION_REQUESTED';
    if (timeoutMs > 0) {
      await new Promise(resolve => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.waiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        this.waiters.add(finish);
      });
    }

    if (hasAuth(this.cookies) && !this.needsSession) return { cookies: this.cookies.slice(), source: 'browser-session-bridge' };
    this.loginRequested = false;
    this.reason = 'SESSION_TIMEOUT';
    throw Object.assign(new Error('Pentagrama browser session is required on an Agent computer'), {
      code: 'PENTAGRAMA_BROWSER_SESSION_REQUIRED',
      infrastructure: true
    });
  }

  credentials() {
    if (!this.configured()) {
      throw Object.assign(new Error('Pentagrama Session Bridge is not configured'), { code: 'PENTAGRAMA_BROWSER_SESSION_NOT_CONFIGURED' });
    }
    return {
      ok: true,
      baseUrl: this.baseUrl,
      loginUrl: `${this.baseUrl}/Login?ReturnUrl=%2f&homeeasy=1`,
      login: this.login,
      password: this.password
    };
  }

  async _handle(req, res) {
    const origin = String(req.headers.origin || '');
    const requestUrl = new URL(req.url, `http://${this.host}:${this.port}`);
    if (req.method === 'GET' && requestUrl.pathname === '/extension/update.xml') {
      if (!this.extensionId || !this.extensionPackagePath) {
        return json(res, 404, { ok: false, code: 'SESSION_BRIDGE_EXTENSION_NOT_CONFIGURED' });
      }
      const codebase = `http://${this.host}:${this.port}/extension/homeeasy-session-bridge.crx`;
      const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${this.extensionId}"><updatecheck codebase="${codebase}" version="${this.extensionVersion}" /></app></gupdate>`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Length', body.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(body);
    }
    if (req.method === 'GET' && requestUrl.pathname === '/extension/homeeasy-session-bridge.crx') {
      if (!this.extensionPackagePath || !fs.existsSync(this.extensionPackagePath)) {
        return json(res, 404, { ok: false, code: 'SESSION_BRIDGE_EXTENSION_PACKAGE_MISSING' });
      }
      const stat = fs.statSync(this.extensionPackagePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-chrome-extension');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-store');
      return fs.createReadStream(this.extensionPackagePath).pipe(res);
    }
    if (req.method === 'OPTIONS') {
      if (!this._allowed(req)) return json(res, 403, { ok: false, code: 'SESSION_BRIDGE_ORIGIN_REJECTED' });
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-HomeEasy-Session-Bridge');
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Vary', 'Origin');
      return res.end();
    }

    if (!this._allowed(req) || String(req.headers['x-homeeasy-session-bridge'] || '') !== '1') {
      return json(res, 403, { ok: false, code: 'SESSION_BRIDGE_ORIGIN_REJECTED' });
    }

    if (req.method === 'GET' && req.url === '/v1/status') return json(res, 200, this.status(), origin);

    if (req.method === 'GET' && req.url.startsWith('/v1/browser/request')) {
      const wait = Number(new URL(req.url, 'http://127.0.0.1').searchParams.get('wait') || 25000);
      const request = await this.nextBrowserRequest(wait);
      return json(res, 200, { ok: true, request }, origin);
    }

    if (req.method === 'POST' && /^\/v1\/browser\/request\/[^/]+\/result$/.test(req.url)) {
      try {
        const id = decodeURIComponent(req.url.split('/')[4] || '');
        const body = await readBody(req, 2 * 1024 * 1024);
        const accepted = this.resolveBrowserRequest(id, body);
        return json(res, accepted ? 200 : 404, { ok: accepted }, origin);
      } catch (error) {
        return json(res, 400, { ok: false, code: error.code || 'SESSION_BRIDGE_INVALID_BROWSER_RESULT', error: error.message }, origin);
      }
    }

    if (req.method === 'GET' && req.url === '/v1/credentials') {
      try { return json(res, 200, this.credentials(), origin); }
      catch (error) { return json(res, 503, { ok: false, code: error.code, error: error.message }, origin); }
    }
    if (req.method === 'POST' && req.url === '/v1/session') {
      try {
        const body = await readBody(req);
        return json(res, 200, this.updateSession(body), origin);
      } catch (error) {
        return json(res, 400, { ok: false, code: error.code || 'SESSION_BRIDGE_INVALID_SESSION', error: error.message }, origin);
      }
    }
    return json(res, 404, { ok: false, code: 'SESSION_BRIDGE_NOT_FOUND' }, origin);
  }

  start() {
    if (this.server) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this._handle(req, res).catch(() => {
          if (!res.headersSent) json(res, 500, { ok: false, code: 'SESSION_BRIDGE_ERROR' });
          else res.end();
        });
      });
      server.on('error', reject);
      server.listen(this.port, this.host, () => {
        this.server = server;
        this.port = server.address().port;
        resolve(this);
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = null;
    return new Promise(resolve => server.close(resolve));
  }
}

module.exports = Object.freeze({
  DEFAULT_PORT,
  SESSION_COOKIE_NAMES,
  PentagramaSessionBridge,
  normalizeCookies,
  hasAuth,
  extensionIdFromPublicKey
});
