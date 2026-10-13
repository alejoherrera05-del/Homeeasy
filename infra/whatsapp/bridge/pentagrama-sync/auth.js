'use strict';

const { ConfigurationError, SessionExpiredError, UpstreamResponseError, AccessBlockedError } = require('./errors');

function splitSetCookie(value) {
  return String(value || '').split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map(item => item.trim()).filter(Boolean);
}

function responseCookies(headers) {
  if (headers && typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  return splitSetCookie(headers && headers.get ? headers.get('set-cookie') : '');
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(headers) {
    for (const value of responseCookies(headers)) {
      const pair = String(value).split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      if (!cookieValue) this.cookies.delete(name);
      else this.cookies.set(name, cookieValue);
    }
  }

  header() {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
  }

  has(name) {
    return Boolean(this.cookies.get(name));
  }

  delete(name) {
    this.cookies.delete(name);
  }

  clear() {
    this.cookies.clear();
  }
}

class PentagramaAuth {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'https://pedidos.persianaspentagrama.com').replace(/\/$/, '');
    this.login = String(options.login || process.env.PENTAGRAMA_LOGIN || '').trim();
    this.password = String(options.password || process.env.PENTAGRAMA_PASSWORD || '');
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(3000, Number(options.timeoutMs || process.env.PENTAGRAMA_TIMEOUT_MS || 20000));
    this.jar = options.jar || new CookieJar();
    this.pendingLogin = null;
    this.authenticated = false;
  }

  configured() {
    return Boolean(this.login && this.password);
  }

  clearSession() {
    this.jar.clear();
    this.authenticated = false;
  }

  async ensureSession() {
    if (this.authenticated) return;
    await this.authenticate();
  }

  async authenticate() {
    if (!this.configured()) {
      throw new ConfigurationError('PENTAGRAMA_LOGIN and PENTAGRAMA_PASSWORD are required');
    }
    if (this.pendingLogin) return this.pendingLogin;
    this.pendingLogin = this._authenticate().finally(() => { this.pendingLogin = null; });
    return this.pendingLogin;
  }

  async _authenticate() {
    const loginUrl = `${this.baseUrl}/Login?ReturnUrl=%2f`;
    const browserHeaders = {
      'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    };
    const form = new URLSearchParams({
      Login: this.login,
      Password: this.password,
      LoginButton: 'Ingresar'
    });
    let response;
    try {
      const preflight = await this.fetch(loginUrl, {
        method: 'GET',
        headers: { ...browserHeaders, 'Accept': 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      this.jar.absorb(preflight.headers);
      if (preflight.status === 403 && /cloudflare/i.test(String(preflight.headers.get('server') || ''))) {
        throw new AccessBlockedError();
      }
      response = await this.fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          ...browserHeaders,
          'Origin': this.baseUrl,
          'Referer': loginUrl,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(this.jar.header() ? { Cookie: this.jar.header() } : {})
        },
        body: form.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (error && error.code) throw error;
      throw new UpstreamResponseError('Pentagrama login is unavailable');
    }
    this.jar.absorb(response.headers);
    const location = String(response.headers.get('location') || '');
    if (response.status === 403 && /cloudflare/i.test(String(response.headers.get('server') || ''))) {
      throw new AccessBlockedError();
    }
    if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) {
      throw new UpstreamResponseError(`Pentagrama login failed with HTTP ${response.status}`, { status: response.status });
    }
    if (/\/(?:User\/)?Login/i.test(location) || (!this.jar.header() && !location)) {
      throw new SessionExpiredError('Pentagrama rejected the configured credentials');
    }
    this.authenticated = true;
  }
}

module.exports = Object.freeze({ CookieJar, PentagramaAuth, responseCookies });
