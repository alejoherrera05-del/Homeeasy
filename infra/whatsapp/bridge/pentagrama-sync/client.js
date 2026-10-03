'use strict';

const { PentagramaAuth } = require('./auth');
const { SessionExpiredError, UpstreamResponseError } = require('./errors');

function looksLikeLoginHtml(text) {
  const value = String(text || '');
  return /<form[^>]+(?:\/User\/Login|action=["']?\/User\/Login)/i.test(value) ||
    (/name=["']Login["']/i.test(value) && /name=["']Password["']/i.test(value));
}

class PentagramaClient {
  constructor(options = {}) {
    this.auth = options.auth || new PentagramaAuth(options);
    this.fetch = options.fetch || this.auth.fetch || globalThis.fetch;
    this.baseUrl = this.auth.baseUrl;
    this.timeoutMs = this.auth.timeoutMs;
  }

  async request(route, options = {}) {
    await this.auth.ensureSession();
    const first = await this._request(route, options);
    if (!this._isExpired(first, options.expect || 'json')) return this._decode(first, options.expect || 'json');

    this.auth.clearSession();
    await this.auth.authenticate();
    const second = await this._request(route, options);
    if (this._isExpired(second, options.expect || 'json')) {
      this.auth.clearSession();
      throw new SessionExpiredError('Pentagrama session could not be renewed');
    }
    return this._decode(second, options.expect || 'json');
  }

  async _request(route, options) {
    const method = String(options.method || 'GET').toUpperCase();
    const url = new URL(route, `${this.baseUrl}/`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers = {
      'Accept': options.expect === 'html' ? 'text/html,application/xhtml+xml' : 'application/json, text/javascript, */*; q=0.01',
      'Cookie': this.auth.jar.header(),
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {})
    };
    let body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json; charset=UTF-8';
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = new URLSearchParams(options.form).toString();
    }

    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (_) {
      throw new UpstreamResponseError('Pentagrama request is unavailable', { route: url.pathname });
    }
    this.auth.jar.absorb(response.headers);
    const text = await response.text().catch(() => '');
    return { response, text, route: url.pathname };
  }

  _isExpired(result, expect) {
    const { response, text } = result;
    const location = String(response.headers.get('location') || '');
    if ([301, 302, 303, 307, 308].includes(response.status) && /\/User\/Login/i.test(location)) return true;
    if (looksLikeLoginHtml(text)) return true;
    if (expect === 'json' && response.status === 500 && /^\s*</.test(text)) return true;
    return false;
  }

  _decode(result, expect) {
    const { response, text, route } = result;
    if (!response.ok) {
      throw new UpstreamResponseError(`Pentagrama request failed with HTTP ${response.status}`, { route, status: response.status });
    }
    if (expect === 'html') {
      if (/^\s*</.test(text)) return text;
      throw new UpstreamResponseError('Pentagrama returned an invalid HTML response', { route });
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new UpstreamResponseError('Pentagrama returned a non-JSON response', { route });
    }
  }

  get(route, query, expect = 'json') {
    return this.request(route, { method: 'GET', query, expect });
  }

  post(route, json) {
    return this.request(route, { method: 'POST', json, expect: 'json' });
  }

  postForm(route, form) {
    return this.request(route, { method: 'POST', form, expect: 'json' });
  }
}

module.exports = Object.freeze({ PentagramaClient, looksLikeLoginHtml });
