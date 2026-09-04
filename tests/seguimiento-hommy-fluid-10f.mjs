import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('seguimiento-hommy.js', 'utf8');
assert.ok(!source.includes('setInterval('), '10F must not introduce polling with setInterval');
assert.ok(source.includes('window.sessionStorage'), '10F should persist lightweight cache for the tab session');
assert.ok(source.includes('BACKGROUND_REFRESH_MS = 3 * 60 * 1000'), '10F should use a prudent background refresh cadence');

const cardMarkup = () => '<article class="crm-card" id="card-29"><div class="card-body-crm"></div></article>';
const dom = new JSDOM(`<!doctype html><html><head></head><body><section id="tarjetas-container">${cardMarkup()}</section></body></html>`, {
  url: 'https://alejoherrera05-del.github.io/Homeeasy/seguimiento.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});

const { window } = dom;
window.TextEncoder = globalThis.TextEncoder;
window.AbortController = globalThis.AbortController;
window.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ target, isIntersecting: true }], this); }
  unobserve() {}
  disconnect() {}
};
window.HomeEasyAuth = {
  getAppSessionToken: () => 'session-test-token',
  restoreHomeEasySession: async () => ({ ok: true }),
  hasPermission: () => false,
};
window.HomeEasyCore = { buildMeta: () => ({ dispositivoId: 'device-test' }) };
window.Swal = { fire: async () => ({ isConfirmed: false }) };

let historyCalls = 0;
let planCalls = 0;
window.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/api/hommy/followup/history')) {
    historyCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        quoteNumber: '29',
        stage: '10E',
        status: {
          state: 'ACTIVE',
          intent: 'WAITING_UNTIL_DATE',
          temperature: 'WAITING',
          attempts: 0,
          lastOutgoingAt: '2026-08-21T18:19:00-05:00',
          lastIncomingAt: '2026-08-21T12:58:00-05:00',
        },
        conversationStyle: {
          preferredAddress: 'doña Sandra',
          honorificObserved: true,
          register: 'USTED',
        },
        history: [
          { at: '2026-08-19T09:35:16-05:00', kind: 'QUOTE_CREATED', text: 'Cotización creada.' },
          { at: '2026-08-21T12:58:00-05:00', kind: 'INCOMING', text: 'Vamos a esperar a esta quincena.' },
          { at: '2026-08-21T18:19:00-05:00', kind: 'OUTGOING', text: 'Muy bien doña Sandra.' },
        ],
      }),
    };
  }
  if (target.endsWith('/api/hommy/followup/plan')) {
    planCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        reviewOnly: true,
        quoteNumber: '29',
        planId: `FUP-TEST-${planCalls}`,
        generatedAt: '2026-09-03T21:20:00-05:00',
        sourceStateVersion: 3,
        sourceAttemptCount: 0,
        stage: '10E',
        plan: {
          decision: 'SEND',
          reasonCode: 'FOLLOWUP_DUE',
          intent: 'READY_TO_BUY',
          temperature: 'HIGH',
          summary: 'La clienta manifestó intención de contratar.',
          objective: 'Retomar de forma respetuosa.',
          message: 'Hola, doña Sandra. Paso por aquí para retomar la propuesta que habíamos dejado pendiente.',
          nextActionAt: null,
          confidence: 0.9,
          needsHumanReview: false,
          stopReason: null,
          explanation: 'Corresponde un seguimiento neutral sin afirmar que la condición ya ocurrió.',
        },
      }),
    };
  }
  throw new Error(`Unexpected fetch: ${url} ${options.method || 'GET'}`);
};

window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise(resolve => setTimeout(resolve, 340));

let panel = window.document.querySelector('#card-29 .he-hommy-followup');
assert.ok(panel, 'Hommy panel should be present');
assert.equal(historyCalls, 1, 'Background warmup should prefetch lightweight history once');
assert.match(panel.textContent, /Hommy/);
assert.match(panel.textContent, /Esperando fecha/);
assert.match(panel.textContent, /Trato: doña Sandra/);
assert.match(panel.textContent, /contexto actualizado/i);

const details = panel.querySelector('.he-hommy-history');
assert.ok(details, 'History control must remain available');
details.open = true;
details.dispatchEvent(new window.Event('toggle'));
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(historyCalls, 1, 'Opening history after background warmup must reuse memory instead of refetching');
assert.match(details.textContent, /Vamos a esperar a esta quincena/);

const analyze = panel.querySelector('.he-hommy-analyze');
assert.ok(analyze, 'Analyze button should remain available');
analyze.click();
await new Promise(resolve => setTimeout(resolve, 35));
assert.equal(planCalls, 1, 'First explicit analysis should call Hommy once');
panel = window.document.querySelector('#card-29 .he-hommy-followup');
assert.match(panel.textContent, /Borrador sugerido/i);
assert.match(panel.textContent, /doña Sandra/);

// Simulate the page rebuilding cards after filters / data refresh. The analysis must reappear instantly from session cache.
const container = window.document.getElementById('tarjetas-container');
container.innerHTML = cardMarkup();
await new Promise(resolve => setTimeout(resolve, 35));
panel = window.document.querySelector('#card-29 .he-hommy-followup');
assert.ok(panel, 'Rebuilt card should be enhanced again');
assert.match(panel.textContent, /Análisis guardado/i);
assert.match(panel.textContent, /Borrador sugerido/i);
assert.equal(planCalls, 1, 'Rebuilding a card must not repeat the AI analysis');

window.close();
console.log('Seguimiento Hommy 10F fluid radar/cache: PASS');
