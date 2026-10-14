'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaClient } = require('./client');

test('Pentagrama client can use real-browser transport without cookie auth', async () => {
  let seen;
  const client = new PentagramaClient({
    baseUrl: 'https://pedidos.persianaspentagrama.com',
    login: 'unused',
    password: 'unused',
    browserTransport: async request => {
      seen = request;
      return {
        status: 200,
        url: request.url,
        headers: { 'content-type': 'application/json' },
        text: JSON.stringify([{ Code: 'OK' }])
      };
    }
  });

  const result = await client.get('/Order/GetJsonCategoryList');
  assert.deepEqual(result, [{ Code: 'OK' }]);
  assert.equal(seen.method, 'GET');
  assert.match(seen.url, /GetJsonCategoryList/);
});

test('Pentagrama client browser transport sends form bodies', async () => {
  let seen;
  const client = new PentagramaClient({
    baseUrl: 'https://pedidos.persianaspentagrama.com',
    login: 'unused',
    password: 'unused',
    browserTransport: async request => {
      seen = request;
      return {
        status: 200,
        url: request.url,
        headers: { 'content-type': 'application/json' },
        text: JSON.stringify({ ok: true })
      };
    }
  });

  await client.postForm('/Atribute/AttributeDepends', { A: '1', B: 'dos' });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
  assert.match(seen.body, /A=1/);
  assert.match(seen.body, /B=dos/);
});
