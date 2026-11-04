'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
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

test('session bridge serves the signed extension only on its loopback listener', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-extension-'));
  const crx = path.join(directory, 'extension.crx');
  fs.writeFileSync(crx, Buffer.from('Cr24-test-package'));
  const bridge = new PentagramaSessionBridge({
    port: 0,
    extensionIds: ['abcdefghijklmnopabcdefghijklmnop', 'cmijhfckibhbdhneapoknlbmfadfmogn'],
    extensionPackagePath: crx,
    extensionVersion: '1.0.4',
    login: 'user',
    password: 'pass'
  });
  await bridge.start();
  t.after(async () => { await bridge.stop(); fs.rmSync(directory, { recursive: true, force: true }); });

  const get = pathname => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: bridge.port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

  const update = await get('/extension/update.xml');
  assert.equal(update.status, 200);
  assert.match(update.type, /application\/xml/);
  assert.match(update.body.toString('utf8'), /appid="abcdefghijklmnopabcdefghijklmnop"/);
  assert.match(update.body.toString('utf8'), /version="1\.0\.4"/);

  const packageResult = await get('/extension/homeeasy-session-bridge.crx');
  assert.equal(packageResult.status, 200);
  assert.equal(packageResult.type, 'application/x-chrome-extension');
  assert.deepEqual(packageResult.body, fs.readFileSync(crx));
});

test('session bridge accepts both the current and legacy extension origins', () => {
  const bridge = new PentagramaSessionBridge({
    extensionIds: ['abcdefghijklmnopabcdefghijklmnop', 'cmijhfckibhbdhneapoknlbmfadfmogn'],
    login: 'user',
    password: 'pass'
  });
  for (const id of bridge.extensionIds) {
    assert.equal(bridge._allowed({ headers: { origin: `chrome-extension://${id}`, 'x-homeeasy-session-bridge': '1' } }), true);
  }
});

test('browser extension treats Pentagrama HTTP 500 HTML as an expired session', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'session-bridge-extension', 'background.js'), 'utf8');
  assert.match(source, /Number\(result\.status\) === 500 && \/\^\\s\*<\//);
  assert.match(source, /freshLoginUrl\(LOGIN_URL\)/);
});
