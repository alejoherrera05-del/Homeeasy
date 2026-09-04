import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('seguimiento-hommy.js', 'utf8');

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <section id="tarjetas-container">
    <article class="crm-card" id="card-29"><div class="card-body-crm"></div></article>
  </section>
</body></html>`, {
  url: 'https://alejoherrera05-del.github.io/Homeeasy/seguimiento.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});

const { window } = dom;
window.TextEncoder = globalThis.TextEncoder;
window.AbortController = globalThis.AbortController;
window.HomeEasyAuth = {
  getAppSessionToken: () => 'session-test-token',
  restoreHomeEasySession: async () => ({ ok: true }),
  hasPermission: () => false,
};
window.HomeEasyCore = {
  buildMeta: () => ({ dispositivoId: 'device-test', pagina: 'seguimiento.html' }),
};
window.Swal = { fire: async () => ({ isConfirmed: false }) };

const calls = [];
window.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (String(url).endsWith('/api/hommy/followup/history')) {
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
          attempts: 1,
          lastOutgoingAt: '2026-09-02T11:00:00-05:00',
          lastIncomingAt: '2026-09-01T12:00:00-05:00',
        },
        conversationStyle: {
          preferredAddress: 'doña Sandra',
          honorificObserved: true,
          register: 'USTED',
        },
        history: [
          {
            at: '2026-08-19T09:35:16-05:00',
            kind: 'QUOTE_CREATED',
            source: 'HOME_EASY',
            text: 'Cotización COT-29 creada.',
          },
          {
            at: '2026-08-19T10:00:00-05:00',
            kind: 'QUOTE_SENT',
            source: 'WHATSAPP',
            text: 'Cotización enviada por WhatsApp.',
          },
          {
            at: '2026-09-01T12:00:00-05:00',
            kind: 'INCOMING',
            source: 'WHATSAPP',
            text: '<img id="history-xss" src=x onerror=alert(1)> Estamos esperando a la quincena.',
          },
        ],
      }),
    };
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise(resolve => setTimeout(resolve, 0));

const panel = window.document.querySelector('#card-29 .he-hommy-followup');
assert.ok(panel, 'Hommy panel should exist');
const details = panel.querySelector('.he-hommy-history');
assert.ok(details, 'History accordion should be present before analysis');
assert.match(details.textContent, /Historial y contexto/);
assert.equal(calls.length, 0, 'History must be lazy and make no request while collapsed');

details.open = true;
details.dispatchEvent(new window.Event('toggle'));
await new Promise(resolve => setTimeout(resolve, 25));

assert.equal(calls.length, 1, 'Opening history should make one read-only history request');
assert.equal(calls[0].url, 'https://homeeasy-hommy-staging.onrender.com/api/hommy/followup/history');
assert.deepEqual(JSON.parse(calls[0].options.body), { numero: '29' });
assert.match(details.textContent, /1 seguimiento enviado/);
assert.match(details.textContent, /Trato: doña Sandra/);
assert.match(details.textContent, /Cotización enviada/);
assert.match(details.textContent, /Cliente respondió/);
assert.equal(window.document.querySelector('#history-xss'), null, 'History text must never be interpreted as HTML');
assert.match(details.textContent, /<img id="history-xss"/);

// Reopening uses the in-memory card cache and must not generate another request.
details.open = false;
details.dispatchEvent(new window.Event('toggle'));
details.open = true;
details.dispatchEvent(new window.Event('toggle'));
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(calls.length, 1, 'Reopening the same loaded history must not refetch');

console.log('Seguimiento Hommy 10E history accordion: PASS');
