import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('seguimiento-hommy.js', 'utf8');
assert.match(source, /CACHE_OWNER_KEY/);
assert.match(source, /INITIAL_RADAR_WARM_COUNT = 8/);
assert.match(source, /retryAfterSeconds/);
assert.match(source, /options\.stale/);
assert.doesNotMatch(source, /setInterval\(/);

const cards = Array.from({ length: 12 }, (_, i) => `<article class="crm-card" id="card-${i + 1}"><div class="card-body-crm"></div></article>`).join('');
const dom = new JSDOM(`<!doctype html><html><head></head><body><section id="tarjetas-container">${cards}</section></body></html>`, {
  url: 'https://alejoherrera05-del.github.io/Homeeasy/seguimiento.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
window.TextEncoder = globalThis.TextEncoder;
window.AbortController = globalThis.AbortController;
window.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() {}
};
window.HomeEasyAuth = {
  getAppSessionToken: () => 'session-owner-a',
  getCurrentProfile: () => ({ email: 'owner-a@example.test', nombre: 'Owner A' }),
  restoreHomeEasySession: async () => ({ ok: true }),
  hasPermission: () => true,
};
window.HomeEasyCore = { buildMeta: () => ({ dispositivoId: 'device-test' }) };
window.Swal = { fire: async () => ({ isConfirmed: false }) };
let historyCalls = 0;
window.fetch = async url => {
  if (String(url).endsWith('/api/hommy/followup/history')) {
    historyCalls += 1;
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true, quoteNumber: '1', status: { state: 'ACTIVE', intent: 'NEW_QUOTE', temperature: 'ACTIVE', attempts: 0 }, conversationStyle: {}, history: [] }),
    };
  }
  if (String(url).endsWith('/api/hommy/followup/plan')) {
    return {
      ok: true, status: 200,
      json: async () => ({
        ok: true, reviewOnly: true, quoteNumber: '1', planId: 'FUP-OLD', generatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), sourceStateVersion: 1,
        plan: { decision: 'SEND', reasonCode: 'FOLLOWUP_DUE', intent: 'NO_RESPONSE', temperature: 'ACTIVE', summary: 'x', objective: 'x', message: 'Hola', nextActionAt: null, confidence: 0.9, needsHumanReview: false, stopReason: null, explanation: 'x' }
      })
    };
  }
  throw new Error(`Unexpected fetch ${url}`);
};

// Seed a stale plan under the current-owner cache key format used by the app.
window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise(resolve => setTimeout(resolve, 450));
assert.ok(historyCalls <= 8, `Initial warmup should not eagerly request all cards; got ${historyCalls}`);

// Authentication change must purge Hommy cache state rather than leaking it to another operator.
window.sessionStorage.setItem('homeeasy:seguimiento:hommy-plan:10f1:1', JSON.stringify({ cachedAt: Date.now(), payload: { plan: { decision: 'SEND' } } }));
window.dispatchEvent(new window.CustomEvent('homeeasy:auth-change', { detail: { type: 'signed-out' } }));
assert.equal(window.sessionStorage.getItem('homeeasy:seguimiento:hommy-plan:10f1:1'), null);

console.log('Seguimiento Hommy 10F.1 audit hardening: PASS');
dom.window.close();
