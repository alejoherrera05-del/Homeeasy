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
  assert.equal(calls[0].url.endsWith('/User/Login'), true);
  assert.equal(calls[1].url.endsWith('/User/Login'), true);
});

test('Pentagrama auth rejects a 200 login page even when a session cookie exists', async () => {
  const fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      return response(200, { 'set-cookie': 'ASP.NET_SessionId=session; path=/; HttpOnly' }, '<form action="/User/Login" method="post"></form>');
    }
    return response(200, { 'set-cookie': 'ASP.NET_SessionId=session2; path=/; HttpOnly' },
      '<form action="/User/Login" method="post"><input name="Login"><input name="Password"></form>');
  };
  const auth = new PentagramaAuth({ login: 'user', password: 'bad', fetch });
  await assert.rejects(() => auth.authenticate(), error => error instanceof SessionExpiredError);
  assert.equal(auth.authenticated, false);
  assert.equal(auth.jar.has('.ASPXAUTH'), false);
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
