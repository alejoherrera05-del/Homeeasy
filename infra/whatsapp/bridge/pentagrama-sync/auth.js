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

  set(name, value) {
    const key = String(name || '').trim();
    if (!key) return;
    const cookieValue = String(value || '');
    if (!cookieValue) this.cookies.delete(key);
    else this.cookies.set(key, cookieValue);
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
    this.sessionProvider = typeof options.sessionProvider === 'function' ? options.sessionProvider : null;
    this.sessionInvalidator = typeof options.sessionInvalidator === 'function' ? options.sessionInvalidator : null;
    this.sessionBootstrap = typeof options.sessionBootstrap === 'function' ? options.sessionBootstrap : null;
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

  async invalidateSession(reason = 'SESSION_EXPIRED') {
    this.clearSession();
    if (this.sessionInvalidator) await this.sessionInvalidator(reason);
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
    if (this.sessionProvider) {
      const supplied = await this.sessionProvider({
        baseUrl: this.baseUrl,
        timeoutMs: Math.max(this.timeoutMs, 45000)
      });
      const cookies = Array.isArray(supplied && supplied.cookies) ? supplied.cookies : [];
      for (const cookie of cookies) this.jar.set(cookie && cookie.name, cookie && cookie.value);
      if (this.jar.has('.ASPXAUTH')) {
        this.authenticated = true;
        return;
      }
      this.clearSession();
      throw new SessionExpiredError('Pentagrama browser session did not include .ASPXAUTH');
    }

    const loginUrl = `${this.baseUrl}/Login?ReturnUrl=%2f`;
    const browserHeaders = {
      'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
    };
    const form = new URLSearchParams({
      Login: this.login,
      Password: this.password,
      LoginButton: 'Ingresar'
    });

    let response;
    let responseText = '';
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
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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
      responseText = await response.text().catch(() => '');
      this.jar.absorb(response.headers);
    } catch (error) {
      if (error && error.code && error.code !== 'PENTAGRAMA_SESSION_EXPIRED') throw error;
    }

    const location = String(response && response.headers && response.headers.get('location') || '');
    if (response && response.status === 403 && /cloudflare/i.test(String(response.headers.get('server') || ''))) {
      throw new AccessBlockedError();
    }
    if (response && !response.ok && ![301, 302, 303, 307, 308].includes(response.status)) {
      throw new UpstreamResponseError(`Pentagrama login failed with HTTP ${response.status}`, { status: response.status });
    }

    const returnedLoginForm = /<form[^>]+action=["']?(?:\/User)?\/Login/i.test(responseText) ||
      (/name=["']Login["']/i.test(responseText) && /name=["']Password["']/i.test(responseText));
    const redirectedBackToLogin = /\/(?:User\/)?Login/i.test(location);
    if (!redirectedBackToLogin && !returnedLoginForm && this.jar.has('.ASPXAUTH')) {
      this.authenticated = true;
      return;
    }

    if (this.sessionBootstrap) {
      const bootstrapped = await this.sessionBootstrap({
        baseUrl: this.baseUrl,
        loginUrl,
        login: this.login,
        password: this.password,
        timeoutMs: Math.max(this.timeoutMs, 45000)
      });
      const cookies = Array.isArray(bootstrapped && bootstrapped.cookies) ? bootstrapped.cookies : [];
      for (const cookie of cookies) this.jar.set(cookie && cookie.name, cookie && cookie.value);
      if (this.jar.has('.ASPXAUTH')) {
        this.authenticated = true;
        return;
      }
    }

    this.clearSession();
    throw new SessionExpiredError('Pentagrama rejected the configured credentials');
  }
}

module.exports = Object.freeze({ CookieJar, PentagramaAuth, responseCookies });
