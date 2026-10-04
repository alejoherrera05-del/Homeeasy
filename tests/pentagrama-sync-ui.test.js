'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveOverview, filterResults, friendlyError } = require('../homeeasy-pentagrama-sync.js');

test('dashboard distinguishes synchronized, pending and unavailable states', () => {
  const agents = [{ online: true }];
  assert.equal(deriveOverview({ counts: { UNCHANGED: 3 }, results: [{ status: 'UNCHANGED' }, { status: 'UNCHANGED' }, { status: 'UNCHANGED' }] }, agents).label, 'Sincronizado');
  assert.equal(deriveOverview({ counts: { INCREASED: 1 }, results: [{ status: 'INCREASED' }] }, agents).label, 'Cambios pendientes');
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
