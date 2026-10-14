'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaAuth } = require('./auth');
const { SessionExpiredError } = require('./errors');

function response(status, headers = {}, body = '') {
  return new Response(body, { status, headers });
}

test('Pentagrama auth accepts login only when .ASPXAUTH is issued', async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if ((options.method || 'GET') === 'GET') {
      return response(200, { 'set-cookie': 'ASP.NET_SessionId=session; path=/; HttpOnly' }, '<form action="/User/Login" method="post"></form>');
    }
    return response(302, {
      location: '/',
      'set-cookie': '.ASPXAUTH=auth-cookie; path=/; HttpOnly; SameSite=Lax'
    });
  };
  const auth = new PentagramaAuth({ login: 'user', password: 'pass', fetch });
  await auth.authenticate();
  assert.equal(auth.authenticated, true);
  assert.equal(auth.jar.has('.ASPXAUTH'), true);
  assert.equal(calls[0].url.includes('/Login?ReturnUrl=%2f'), true);
  assert.equal(calls[1].url.includes('/Login?ReturnUrl=%2f'), true);
});

test('Pentagrama auth falls back to browser bootstrap when Cloudflare blocks form login', async () => {
  const fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      return response(200, { 'set-cookie': 'ASP.NET_SessionId=session; path=/; HttpOnly' }, '<form action="/Login?ReturnUrl=%2f" method="post"></form>');
    }
    return response(200, { 'set-cookie': 'ASP.NET_SessionId=session2; path=/; HttpOnly' },
      '<form action="/Login?ReturnUrl=%2f" method="post"><input name="Login"><input name="Password"></form>');
  };
  let bootstraps = 0;
  const auth = new PentagramaAuth({
    login: 'user',
    password: 'pass',
    fetch,
    sessionBootstrap: async () => {
      bootstraps += 1;
      return { cookies: [
        { name: 'cf_clearance', value: 'clearance' },
        { name: 'ASP.NET_SessionId', value: 'browser-session' },
        { name: '.ASPXAUTH', value: 'browser-auth' }
      ] };
    }
  });
  await auth.authenticate();
  assert.equal(bootstraps, 1);
  assert.equal(auth.authenticated, true);
  assert.equal(auth.jar.has('.ASPXAUTH'), true);
  assert.match(auth.jar.header(), /cf_clearance=clearance/);
});

test('Pentagrama auth rejects redirect back to login', async () => {
  const fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') return response(200, {}, '');
    return response(302, { location: '/User/Login' });
  };
  const auth = new PentagramaAuth({ login: 'user', password: 'bad', fetch });
  await assert.rejects(() => auth.authenticate(), error => error instanceof SessionExpiredError);
  assert.equal(auth.authenticated, false);
});

test('Pentagrama auth still fails if browser bootstrap cannot obtain auth cookie', async () => {
  const fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') return response(200, {}, '<form action="/Login?ReturnUrl=%2f" method="post"></form>');
    return response(200, {}, '<input name="Login"><input name="Password">');
  };
  const auth = new PentagramaAuth({
    login: 'user',
    password: 'pass',
    fetch,
    sessionBootstrap: async () => ({ cookies: [{ name: 'cf_clearance', value: 'clearance-only' }] })
  });
  await assert.rejects(() => auth.authenticate(), error => error instanceof SessionExpiredError);
  assert.equal(auth.authenticated, false);
});


test('Pentagrama auth trusts a browser session provider before form login', async () => {
  let fetchCalls = 0;
  const auth = new PentagramaAuth({
    login: 'user',
    password: 'pass',
    fetch: async () => { fetchCalls += 1; throw new Error('HTTP login should not run'); },
    sessionProvider: async () => ({
      cookies: [
        { name: 'cf_clearance', value: 'clearance' },
        { name: 'ASP.NET_SessionId', value: 'session' },
        { name: '.ASPXAUTH', value: 'auth' }
      ]
    })
  });
  await auth.authenticate();
  assert.equal(auth.authenticated, true);
  assert.equal(auth.jar.has('.ASPXAUTH'), true);
  assert.equal(fetchCalls, 0);
});

test('Pentagrama auth invalidation notifies the browser session bridge', async () => {
  const reasons = [];
  const auth = new PentagramaAuth({
    login: 'user',
    password: 'pass',
    sessionProvider: async () => ({ cookies: [{ name: '.ASPXAUTH', value: 'auth' }] }),
    sessionInvalidator: async reason => reasons.push(reason)
  });
  await auth.authenticate();
  await auth.invalidateSession('EXPIRED');
  assert.equal(auth.authenticated, false);
  assert.deepEqual(reasons, ['EXPIRED']);
});
