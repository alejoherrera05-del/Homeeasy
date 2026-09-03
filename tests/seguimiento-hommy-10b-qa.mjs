import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('seguimiento-hommy.js', 'utf8');

function card(number) {
  return `
    <article class="crm-card" id="card-${number}">
      <div class="card-body-crm">
        <div class="note-box">Sin nota</div>
      </div>
    </article>`;
}

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <section id="tarjetas-container">${card('32')}</section>
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
};
window.HomeEasyCore = {
  buildMeta: () => ({ dispositivoId: 'device-test', pagina: 'seguimiento.html' }),
};
window.Swal = { fire: () => {} };

let calls = [];
window.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      reviewOnly: true,
      quoteNumber: '32',
      plan: {
        decision: 'SEND',
        reasonCode: 'FOLLOWUP_DUE',
        intent: 'EVALUATING',
        temperature: 'ACTIVE',
        summary: 'Seguimiento útil.',
        objective: 'Retomar con contexto.',
        message: 'Hola Karen <script id="draft-xss">alert(1)</script> ¿Quieres que revisemos las opciones?',
        nextActionAt: null,
        confidence: 0.88,
        needsHumanReview: false,
        stopReason: null,
        explanation: '<img id="reason-xss" src=x onerror=alert(1)> Hay una razón comercial para retomar.',
      },
    }),
  };
};

window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise(resolve => setTimeout(resolve, 0));

const panel = window.document.querySelector('#card-32 .he-hommy-followup');
assert.ok(panel, 'Hommy panel should be injected into each quote card');
assert.match(panel.textContent, /Analizar con Hommy/);
assert.match(panel.textContent, /no envía mensajes/i);

const analyzeButton = panel.querySelector('.he-hommy-analyze');
assert.ok(analyzeButton, 'Analyze button should exist');
analyzeButton.click();
await new Promise(resolve => setTimeout(resolve, 15));

assert.equal(calls.length, 1, 'One analysis request should be sent');
assert.equal(calls[0].url, 'https://homeeasy-hommy-staging.onrender.com/api/hommy/followup/plan');
assert.equal(calls[0].options.method, 'POST');
assert.equal(calls[0].options.headers['X-HomeEasy-Session'], 'session-test-token');
assert.ok(calls[0].options.headers['X-HomeEasy-Meta']);
assert.deepEqual(Object.keys(JSON.parse(calls[0].options.body)), ['numero']);
assert.deepEqual(JSON.parse(calls[0].options.body), { numero: '32' });

assert.match(panel.textContent, /Borrador recomendado/);
assert.match(panel.textContent, /Modo REVIEW/);
assert.equal(window.document.querySelector('#reason-xss'), null, 'Model explanation must render as text, never HTML');
assert.equal(window.document.querySelector('#draft-xss'), null, 'Model draft must render as text, never HTML');
assert.match(panel.querySelector('.he-hommy-reason').textContent, /<img id="reason-xss"/);
assert.match(panel.querySelector('.he-hommy-draft-text').textContent, /<script id="draft-xss"/);

const actionLabels = [...panel.querySelectorAll('button')].map(button => button.textContent.trim());
assert.ok(actionLabels.includes('Analizar de nuevo'));
assert.ok(actionLabels.includes('Copiar borrador'));
assert.ok(!actionLabels.some(label => /enviar/i.test(label)), '10B UI must not expose a send action');

const container = window.document.getElementById('tarjetas-container');
container.innerHTML = card('33');
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(window.document.querySelector('#card-33 .he-hommy-followup'), 'Panel should survive Seguimiento card re-renders');

console.log('Seguimiento Hommy 10B browser contract: PASS');
