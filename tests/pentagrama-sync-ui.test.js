'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveOverview, filterResults, friendlyError } = require('../homeeasy-pentagrama-sync.js');

test('dashboard distinguishes full, partial, actionable and operational error states', () => {
  const agents = [{ online: true }];
  assert.equal(deriveOverview({ counts: { UNCHANGED: 3 }, catalogAudit: { total: 3, certified: 3 }, results: [{ id: 'a', status: 'UNCHANGED' }, { id: 'b', status: 'UNCHANGED' }, { id: 'c', status: 'UNCHANGED' }] }, agents).label, 'Sincronizado');
  const partial = deriveOverview({ counts: { UNCHANGED: 90, REVIEW_REQUIRED: 82, UNMAPPED: 280 }, catalogAudit: { total: 452, certified: 90, reviewRequired: 82, unmapped: 280 }, results: [] }, agents);
  assert.equal(partial.label, 'Operativo · cobertura parcial');
  assert.equal(partial.tone, 'success');
  assert.deepEqual({ certified: partial.certified, review: partial.review, unmapped: partial.unmapped }, { certified: 90, review: 82, unmapped: 280 });
  assert.equal(deriveOverview({ counts: { INCREASED: 1, REVIEW_REQUIRED: 82 }, results: [{ status: 'INCREASED' }] }, agents).label, 'Actualizaciones disponibles');
  assert.equal(deriveOverview({ counts: { ERROR: 1, REVIEW_REQUIRED: 82 }, results: [{ status: 'ERROR' }] }, agents).label, 'Requiere atención');
  assert.equal(deriveOverview({ counts: {}, results: [] }, [{ online: false }]).label, 'Sin agente disponible');
});

test('result filters preserve only the requested operational state', () => {
  const results = [{ status: 'INCREASED' }, { status: 'UNMAPPED' }, { status: 'DECREASED' }];
  assert.equal(filterResults(results, 'ALL').length, 3);
  assert.deepEqual(filterResults(results, 'UNMAPPED'), [{ status: 'UNMAPPED' }]);
});

test('technical errors are translated into safe user-facing guidance', () => {
  assert.match(friendlyError({ code: 'AGENT_OFFLINE' }), /Enciende uno de los equipos/);
  assert.match(friendlyError({ code: 'PENTAGRAMA_SESSION_EXPIRED' }), /sesión de Pentagrama/);
  assert.match(friendlyError({ code: 'PENTAGRAMA_SCAN_EXPIRED' }), /análisis venció/);
  assert.match(friendlyError({ code: 'QA_FAILED' }), /restaurado automáticamente/);
});
