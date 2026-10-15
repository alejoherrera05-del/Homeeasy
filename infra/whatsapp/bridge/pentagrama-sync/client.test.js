'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaClient } = require('./client');

function fakeAuth() {
  return {
    baseUrl: 'https://pedidos.persianaspentagrama.com',
    timeoutMs: 1000,
    fetch: async () => { throw new Error('direct fetch must not run'); },
    jar: { header: () => '', absorb: () => {} },
    ensureSession: async () => { throw new Error('direct auth must not run'); },
    clearSession() {},
    authenticate: async () => {}
  };
}

test('browser transport executes Pentagrama request with page-session semantics', async () => {
  let requestSeen = null;
  const client = new PentagramaClient({
    auth: fakeAuth(),
    browserTransport: async request => {
      requestSeen = request;
      return {
        status: 200,
        url: request.url,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        text: JSON.stringify({ ok: true, value: 123 })
      };
    }
  });

  const result = await client.get('/Order/GetProductPrice', {
    ProductCode: 'CORONSERIVEANGGRE',
    Width: 1,
    Height: 1
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, 123);
  assert.equal(requestSeen.method, 'GET');
  assert.match(requestSeen.url, /\/Order\/GetProductPrice/);
  assert.match(requestSeen.url, /ProductCode=CORONSERIVEANGGRE/);
  assert.equal(requestSeen.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal('Cookie' in requestSeen.headers, false);
});

test('browser transport rejects a response that resolves back to Pentagrama login', async () => {
  const client = new PentagramaClient({
    auth: fakeAuth(),
    browserTransport: async request => ({
      status: 200,
      url: 'https://pedidos.persianaspentagrama.com/Login?ReturnUrl=%2f',
      headers: { 'content-type': 'text/html' },
      text: '<form action="/User/Login"><input name="Login"><input name="Password"></form>'
    })
  });

  await assert.rejects(
    () => client.get('/Order/GetJsonCategoryList', {}),
    error => error && error.code === 'PENTAGRAMA_SESSION_EXPIRED'
  );
});

test('browser transport preserves POST JSON payloads without leaking a synthetic cookie header', async () => {
  let requestSeen = null;
  const client = new PentagramaClient({
    auth: fakeAuth(),
    browserTransport: async request => {
      requestSeen = request;
      return { status: 200, url: request.url, headers: {}, text: '{"ok":true}' };
    }
  });

  await client.post('/Order/Test', { a: 1 });
  assert.equal(requestSeen.method, 'POST');
  assert.equal(requestSeen.body, '{"a":1}');
  assert.equal(requestSeen.headers['Content-Type'], 'application/json; charset=UTF-8');
  assert.equal('Cookie' in requestSeen.headers, false);
});
