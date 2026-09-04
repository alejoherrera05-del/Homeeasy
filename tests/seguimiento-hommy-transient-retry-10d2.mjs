import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('seguimiento-hommy.js', 'utf8');

function successPayload() {
  return {
    ok: true,
    reviewOnly: true,
    quoteNumber: '32',
    planId: 'FUP-TEST',
    generatedAt: '2026-09-03T19:00:00-05:00',
    sourceStateVersion: 1,
    plan: {
      decision: 'SEND',
      reasonCode: 'FOLLOWUP_DUE',
      intent: 'NO_RESPONSE',
      temperature: 'ACTIVE',
      summary: 'La cotización fue enviada y no hay respuesta posterior.',
      objective: 'Retomar de forma ligera.',
      message: 'Hola Karen 😊 ¿alcanzaste a revisar la propuesta? Si tienes alguna duda, con gusto te ayudo.',
      nextActionAt: null,
      confidence: 0.9,
      needsHumanReview: false,
      stopReason: null,
      explanation: 'WhatsApp confirma envío sin respuesta posterior.'
    }
  };
}

function transientResponse(code = 'FOLLOWUP_UPSTREAM_TIMEOUT') {
  return {
    ok: false,
    status: 503,
    json: async () => ({
      ok: false,
      error: { code, message: 'HomeEasy tardó demasiado en entregar el seguimiento.' }
    })
  };
}

function okResponse() {
  return { ok: true, status: 200, json: async () => successPayload() };
}

function createDom(fetchImpl) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <section id="tarjetas-container">
      <article class="crm-card" id="card-32"><div class="card-body-crm"></div></article>
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
  window.HomeEasyCore = { buildMeta: () => ({ dispositivoId: 'device-test' }) };
  window.Swal = { fire: () => {} };
  window.fetch = fetchImpl;
  window.eval(source);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return dom;
}

{
  let calls = 0;
  const dom = createDom(async () => {
    calls += 1;
    return calls === 1 ? transientResponse() : okResponse();
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 0));
  const panel = window.document.querySelector('.he-hommy-followup');
  panel.querySelector('.he-hommy-analyze').click();
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(calls, 2, 'Transient read failure should be retried exactly once');
  assert.match(panel.textContent, /Borrador recomendado/);
  assert.doesNotMatch(panel.textContent, /Hommy no pudo completar/);
  dom.window.close();
}

{
  let calls = 0;
  const dom = createDom(async () => {
    calls += 1;
    return transientResponse('FOLLOWUP_UPSTREAM_UNAVAILABLE');
  });
  const { window } = dom;
  await new Promise(resolve => setTimeout(resolve, 0));
  const panel = window.document.querySelector('.he-hommy-followup');
  panel.querySelector('.he-hommy-analyze').click();
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(calls, 2, 'Persistent transient failure must stop after one automatic retry');
  assert.match(panel.textContent, /conexión con HomeEasy está lenta/i);
  assert.match(panel.textContent, /no envió nada ni cambió datos/i);
  dom.window.close();
}

console.log('Seguimiento Hommy transient read retry 10D.2: PASS');
