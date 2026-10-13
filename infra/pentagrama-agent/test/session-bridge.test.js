'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaSessionBridge, normalizeCookies } = require('../src/session-bridge');

test('normalizeCookies only keeps Pentagrama session cookies', () => {
  const cookies = normalizeCookies([
    { name: '.ASPXAUTH', value: 'auth', httpOnly: true },
    { name: 'ASP.NET_SessionId', value: 'session' },
    { name: 'cf_clearance', value: 'clearance' },
    { name: 'other', value: 'ignore' }
  ]);
  assert.deepEqual(cookies.map(cookie => cookie.name).sort(), ['.ASPXAUTH', 'ASP.NET_SessionId', 'cf_clearance'].sort());
});

test('session bridge accepts a real auth session and invalidates it', async () => {
  const bridge = new PentagramaSessionBridge({
    port: 0,
    extensionId: 'cmijhfckibhbdhneapoknlbmfadfmogn',
    login: 'user',
    password: 'pass'
  });
  bridge.updateSession({
    browser: 'Brave',
    cookies: [
      { name: '.ASPXAUTH', value: 'auth' },
      { name: 'ASP.NET_SessionId', value: 'session' },
      { name: 'cf_clearance', value: 'clearance' }
    ]
  });
  const session = await bridge.session({ timeoutMs: 1 });
  assert.equal(session.source, 'browser-session-bridge');
  assert.equal(session.cookies.some(cookie => cookie.name === '.ASPXAUTH'), true);
  bridge.invalidate('TEST');
  assert.equal(bridge.status().needsSession, true);
  await assert.rejects(() => bridge.session({ timeoutMs: 1 }), error => error.code === 'PENTAGRAMA_BROWSER_SESSION_REQUIRED');
});

test('credentials are only available when bridge is configured', () => {
  const bridge = new PentagramaSessionBridge({
    extensionId: 'cmijhfckibhbdhneapoknlbmfadfmogn',
    login: 'user',
    password: 'pass'
  });
  const credentials = bridge.credentials();
  assert.equal(credentials.login, 'user');
  assert.equal(credentials.password, 'pass');
  assert.match(credentials.loginUrl, /homeeasy=1/);
});


test('session bridge accepts originless MV3 worker call only with marker', () => {
  const bridge = new PentagramaSessionBridge({
    extensionId: 'cmijhfckibhbdhneapoknlbmfadfmogn',
    login: 'user',
    password: 'pass'
  });
  assert.equal(bridge._allowed({ headers: { 'x-homeeasy-session-bridge': '1' } }), true);
  assert.equal(bridge._allowed({ headers: {} }), false);
});

test('session bridge rejects foreign browser origins', () => {
  const bridge = new PentagramaSessionBridge({
    extensionId: 'cmijhfckibhbdhneapoknlbmfadfmogn',
    login: 'user',
    password: 'pass'
  });
  assert.equal(bridge._allowed({
    headers: {
      origin: 'https://example.com',
      'x-homeeasy-session-bridge': '1'
    }
  }), false);
});


test('session bridge relays a browser request and response', async () => {
  const bridge = new PentagramaSessionBridge({
    extensionId: 'cmijhfckibhbdhneapoknlbmfadfmogn',
    login: 'user',
    password: 'pass'
  });

  const pending = bridge.browserRequest({ url: 'https://pedidos.persianaspentagrama.com/Order/GetJsonCategoryList', method: 'GET' }, 1000);
  const request = await bridge.nextBrowserRequest(10);
  assert.ok(request && request.id);
  assert.equal(request.payload.method, 'GET');

  bridge.resolveBrowserRequest(request.id, {
    ok: true,
    result: {
      status: 200,
      url: request.payload.url,
      headers: { 'content-type': 'application/json' },
      text: '[]'
    }
  });

  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.text, '[]');
});
