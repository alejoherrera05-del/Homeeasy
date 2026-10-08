'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PentagramaAuth } = require('./auth');
const { PentagramaClient } = require('./client');
const { PentagramaCatalog } = require('./catalog');
const { PentagramaPricing } = require('./pricing');
const { HomeEasyCostClient } = require('./homeeasy');
const { PentagramaComparison } = require('./comparison');

function response(body, options = {}) {
  return new Response(body, {
    status: options.status || 200,
    headers: options.headers || { 'Content-Type': 'application/json' }
  });
}

test('auth captures .ASPXAUTH without exposing credentials', async () => {
  const requests = [];
  const auth = new PentagramaAuth({
    login: 'private-user',
    password: 'private-password',
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return response('', { status: 302, headers: { Location: '/Order/SearchProduct', 'Set-Cookie': '.ASPXAUTH=session-one; path=/; HttpOnly' } });
    }
  });
  await auth.authenticate();
  assert.equal(auth.jar.has('.ASPXAUTH'), true);
  assert.match(auth.jar.header(), /^\.ASPXAUTH=/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.redirect, 'manual');
  assert.match(requests[0].options.body, /Login=private-user/);
  assert.match(requests[0].options.body, /Password=private-password/);
});

test('JSON request renews an expired session once', async () => {
  let logins = 0;
  let prices = 0;
  const fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/User/Login') {
      logins += 1;
      return response('', { status: 302, headers: { Location: '/', 'Set-Cookie': `.ASPXAUTH=session-${logins}; path=/; HttpOnly` } });
    }
    if (path === '/Order/GetProductPrice') {
      prices += 1;
      if (prices === 1) return response('<form action="/User/Login"><input name="Login"><input name="Password"></form>', { headers: { 'Content-Type': 'text/html' } });
      return response('244800');
    }
    throw new Error(`Unexpected path ${path}`);
  };
  const client = new PentagramaClient({ login: 'user', password: 'password', fetch });
  const result = await client.get('/Order/GetProductPrice', { ProductCode: 'TEST' });
  assert.equal(result, 244800);
  assert.equal(logins, 2);
  assert.equal(prices, 2);
});

test('Cloudflare VPS rejection is reported as an operational block, not bad credentials', async () => {
  const auth = new PentagramaAuth({
    login: 'user',
    password: 'password',
    fetch: async () => response('<title>Attention Required! | Cloudflare</title>', {
      status: 403,
      headers: { Server: 'cloudflare', 'Content-Type': 'text/html' }
    })
  });
  await assert.rejects(() => auth.authenticate(), error => {
    assert.equal(error.code, 'PENTAGRAMA_ACCESS_BLOCKED');
    assert.equal(error.statusCode, 502);
    return true;
  });
});

test('catalog wrappers preserve endpoint methods and payloads', async () => {
  const calls = [];
  const client = {
    get: async (route, params, expect) => { calls.push({ method: 'GET', route, params, expect }); return {}; },
    post: async (route, params) => { calls.push({ method: 'POST', route, params }); return {}; },
    postForm: async (route, params) => { calls.push({ method: 'POST_FORM', route, params }); return {}; }
  };
  const catalog = new PentagramaCatalog(client);
  await catalog.categories({ level: 1 });
  await catalog.products({ Category1: 20 });
  await catalog.attributes({ ProductCode: 'P' });
  await catalog.defaults({ ProductCode: 'P' });
  await catalog.dependencies({ idAttribute: 1 });
  await catalog.alerts({ code: 'P' });
  await catalog.validateRoller({ codigoProducto: 'P' });
  assert.deepEqual(calls.map(call => [call.method, call.route]), [
    ['GET', '/Order/GetJsonCategoryList'],
    ['GET', '/Order/GetJsonProductList'],
    ['GET', '/Atribute/ProductAttributes'],
    ['GET', '/Atribute/GetAttributesDefaultValues'],
    ['POST', '/Atribute/AttributeDepends'],
    ['POST', '/Order/GetAlertListByParameters'],
    ['POST_FORM', '/Order/ValidarAltMaxEnrollable']
  ]);
  assert.equal(calls[2].expect, 'html');
});

test('pricing reconstructs distributor discount and VAT exactly', async () => {
  const client = {
    get: async (route, params) => {
      if (route === '/Order/GetProductPrice') return 244800;
      if (route === '/Atribute/ProductAttributes') {
        assert.equal(params.ProductCode, 'CORONSEVECORWH2.8');
        assert.equal(params.Group, 'ONDASE');
        assert.equal(params.Discount, 0);
        return "<script>var distDiscountAttributes = parseFloat('0.37'); var distDiscount = parseFloat(String('37').replace(',', '.'));</script>";
      }
      throw new Error(`Unexpected route ${route}`);
    }
  };
  const pricing = new PentagramaPricing(client);
  const result = await pricing.supplierCost({ ProductCode: 'CORONSEVECORWH2.8', Width: 1, Height: 1, GroupCode: 1345, AssociationGroup: 'ONDASE', Discount: 0 });
  assert.equal(result.basePrice, 244800);
  assert.equal(result.distributorDiscount, 0.37);
  assert.equal(result.subtotal, 154224);
  assert.equal(result.total, 183526.56);
});

test('pricing supports Pentagrama fixed promotional net values', async () => {
  const pricing = new PentagramaPricing({ get: async route => {
    assert.equal(route, '/Order/GetProductPrice');
    return 376960;
  } });
  const result = await pricing.supplierCost({ ProductCode: 'ENRSTDBOMA3090', Width: 2, Height: 3.2, GroupCode: 599 }, { pricingMode: 'net-before-vat' });
  assert.equal(result.subtotal, 376960);
  assert.equal(result.total, 448582.4);
});

test('HomeEasy client reads private calculated unit cost without catalog leakage', async () => {
  let payload;
  const client = new HomeEasyCostClient({
    backendUrl: 'https://homeeasy.invalid/exec',
    fetch: async (_url, options) => {
      payload = JSON.parse(options.body);
      return response(JSON.stringify({ status: 'ok', version: 'qa', validThrough: '2026-10-31', quote: { ok: true, items: [{ unit: 18352656 }] } }));
    }
  });
  const result = await client.cost({ product: 'onda-67', width: '1', height: '1', quantity: '1' }, { sessionToken: 'session', deviceId: 'device' });
  assert.equal(result.amount, 183526.56);
  assert.equal(payload.tipo, 'COSTOS_CALCULAR_COTIZACION');
  assert.equal(payload.margin, '0');
  assert.equal(payload.appSessionToken, 'session');
});

test('HomeEasy scheduler client uses the scoped read-only service route', async () => {
  let payload;
  const client = new HomeEasyCostClient({
    backendUrl: 'https://homeeasy.invalid/exec',
    fetch: async (_url, options) => {
      payload = JSON.parse(options.body);
      return response(JSON.stringify({ status: 'ok', quote: { ok: true, items: [{ unit: 10000 }] } }));
    }
  });
  await client.cost({ product: 'vertical-1', width: '1', height: '1', quantity: '1' }, { serviceKey: 'scheduler-secret', deviceId: 'pentagrama-scheduler' });
  assert.equal(payload.tipo, 'COSTOS_SYNC_COST');
  assert.equal(payload.pentagramaSyncKey, 'scheduler-secret');
  assert.equal(payload.appSessionToken, '');
});

test('comparison checks Vertical, Onda Serena and Enrollable and reports only changes', async () => {
  const mappings = [
    { id: 'v', family: 'Vertical', homeeasyId: 'vertical-1', productCode: 'V', groupCode: '1', calculationType: 'NormalProduct', width: '1.2', height: '1.3', quantity: 1, strategy: 'RATE_M2', destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' } },
    { id: 'o', family: 'Onda Serena', homeeasyId: 'onda-67', productCode: 'O', groupCode: '2', calculationType: 'NormalProduct', width: '1', height: '1', quantity: 1, strategy: 'RATE_M2', destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' } },
    { id: 'e', family: 'Enrollable', homeeasyId: 'enrollable-1', productCode: 'E', groupCode: '3', calculationType: 'NormalProduct', width: '2', height: '3.2', quantity: 1, strategy: 'SPECIAL_CONFIGURATION', destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' } }
  ];
  const portalCosts = { V: 137187.96, O: 183526.56, E: 448582.4 };
  const homeCosts = { 'vertical-1': 137187.96, 'onda-67': 183526.56, 'enrollable-1': 440000 };
  const comparison = new PentagramaComparison({
    mappings,
    pricing: { supplierCost: async params => ({ total: portalCosts[params.ProductCode] }) },
    homeeasy: { cost: async item => ({ amount: homeCosts[item.product] }) }
  });
  const result = await comparison.check({ homeeasyContext: {} });
  assert.equal(result.summary.checked, 3);
  assert.equal(result.summary.same, 2);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.summary.errors, 0);
  assert.equal(result.changes[0].family, 'Enrollable');
  assert.equal(result.changes[0].difference, 8582.4);
});
