'use strict';

const http = require('http');

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

class PentagramaSessionBridge {
  constructor(options = {}) {
    this.host = String(options.host || '127.0.0.1');
    this.port = Number(options.port || process.env.PENTAGRAMA_SESSION_BRIDGE_PORT || DEFAULT_PORT);
    this.extensionId = String(options.extensionId || process.env.PENTAGRAMA_SESSION_BRIDGE_EXTENSION_ID || '').trim();
    this.allowedOrigin = this.extensionId ? `chrome-extension://${this.extensionId}` : '';
    this.login = String(options.login || '');
    this.password = String(options.password || '');
    this.baseUrl = String(options.baseUrl || 'https://pedidos.persianaspentagrama.com').replace(/\/$/, '');
    this.cookies = [];
    this.updatedAt = null;
    this.browser = null;
    this.needsSession = true;
    this.reason = 'STARTUP';
    this.server = null;
    this.waiters = new Set();
  }

  configured() {
    return Boolean(this.allowedOrigin && this.login && this.password);
  }

  status() {
    return {
      ok: true,
      configured: this.configured(),
      needsSession: this.needsSession || !hasAuth(this.cookies),
      hasAuth: hasAuth(this.cookies),
      updatedAt: this.updatedAt,
      browser: this.browser,
      reason: this.reason
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
    const originAllowed = !origin || origin === this.allowedOrigin;
    return Boolean(this.allowedOrigin && originAllowed && marker === '1');
  }

  _wake() {
    for (const finish of Array.from(this.waiters)) finish();
    this.waiters.clear();
  }

  updateSession(payload = {}) {
    const cookies = normalizeCookies(payload.cookies);
    if (!hasAuth(cookies)) {
      throw Object.assign(new Error('Pentagrama session does not include .ASPXAUTH'), { code: 'PENTAGRAMA_BROWSER_SESSION_INVALID' });
    }
    this.cookies = cookies;
    this.updatedAt = new Date().toISOString();
    this.browser = payload.browser ? String(payload.browser).slice(0, 120) : null;
    this.needsSession = false;
    this.reason = null;
    this._wake();
    return this.status();
  }

  invalidate(reason = 'SESSION_EXPIRED') {
    this.cookies = [];
    this.updatedAt = null;
    this.needsSession = true;
    this.reason = String(reason || 'SESSION_EXPIRED').slice(0, 120);
  }

  async session(options = {}) {
    const timeoutMs = Math.max(0, Math.min(60000, Number(options.timeoutMs || 45000)));
    if (hasAuth(this.cookies) && !this.needsSession) return { cookies: this.cookies.slice(), source: 'browser-session-bridge' };

    this.needsSession = true;
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
  hasAuth
});
