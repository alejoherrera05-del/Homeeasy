'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProposal } = require('./strategies');

const source = { method: 'area', minHeight: 1.3, minArea: 1.6, promotional: false, extraDiscount: 0 };
const rateMapping = { strategy: 'RATE_M2', status: 'CERTIFIED', verifiedAt: '2026-10-08T00:00:00Z',
  casesPassed: 3, maxDifference: 0, autoApplicable: true, destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' } };

test('RATE_M2 derives only from non-minimum cases and validates the boundary', () => {
  const evidence = [
    { id: 'a', role: 'derive', width: 2, height: 2, pentagrama: { total: 400000 } },
    { id: 'b', role: 'derive', width: 2.4, height: 2, pentagrama: { total: 480000 } },
    { id: 'minimum', role: 'boundary', width: 1, height: 1, pentagrama: { total: 160000 } }
  ];
  const result = buildProposal(rateMapping, source, evidence);
  assert.equal(result.autoApplicable, true);
  assert.equal(result.proposedRate, 100000);
  assert.equal(result.cases.length, 3);
});

test('Panel/Vertical minimum mismatch is REVIEW_REQUIRED instead of changing a rate', () => {
  const evidence = [
    { id: 'a', role: 'derive', width: 2, height: 2, pentagrama: { total: 400000 } },
    { id: 'b', role: 'derive', width: 2.4, height: 2, pentagrama: { total: 480000 } },
    { id: 'minimum', role: 'boundary', width: 1, height: 1, pentagrama: { total: 130000 } }
  ];
  const result = buildProposal(rateMapping, source, evidence);
  assert.equal(result.autoApplicable, false);
  assert.match(result.reason, /no reproduce Pentagrama/);
});

test('matrix and special configurations never use one-quote proportionality', () => {
  const evidence = [{ id: 'x', role: 'evidence', width: 1, height: 1, pentagrama: { total: 100 } }];
  assert.equal(buildProposal({ strategy: 'MATRIX', autoApplicable: true }, { method: 'matrix' }, evidence).autoApplicable, false);
  assert.equal(buildProposal({ strategy: 'SPECIAL_CONFIGURATION', autoApplicable: false, reviewReason: 'ambiguous' }, source, evidence).autoApplicable, false);
});

test('a structurally complete mapping without Pentagrama certification is never auto-applicable', () => {
  const evidence = [
    { id: 'a', role: 'derive', width: 2, height: 2, pentagrama: { total: 400000 } },
    { id: 'b', role: 'derive', width: 2.4, height: 2, pentagrama: { total: 480000 } },
    { id: 'minimum', role: 'boundary', width: 1, height: 1, pentagrama: { total: 160000 } }
  ];
  const result = buildProposal({ ...rateMapping, status: 'REVIEW_REQUIRED' }, source, evidence);
  assert.equal(result.autoApplicable, false);
  assert.match(result.reason, /certificado Pentagrama/);
});

test('COMPLEMENT derives Coverlight for two sides and Perfil OUT for one width', () => {
  const certified = { strategy: 'COMPLEMENT', status: 'CERTIFIED', verifiedAt: '2026-11-17T20:42:09Z',
    casesPassed: 3, maxDifference: 0, destination: { sheet: 'Costos_Pentagrama', field: 'Tarifa_IVA_COP' } };
  const coverlight = buildProposal({ ...certified, quantity: 1, homeeasy: { quantity: '2' } }, {
    method: 'linear-height', promotional: false
  }, [
    { id: 'a', role: 'derive', width: 1.83, height: 1.2, pentagrama: { total: 29688.12 } },
    { id: 'b', role: 'derive', width: 1.83, height: 2.2, pentagrama: { total: 54428.22 } },
    { id: 'c', role: 'validate', width: 2.5, height: 2.8, pentagrama: { total: 69272.28 } }
  ]);
  assert.equal(coverlight.autoApplicable, true);
  assert.equal(coverlight.proposedRate, 12370.05);
  const profile = buildProposal({ ...certified, quantity: 1, homeeasy: { quantity: '1' } }, {
    method: 'linear-width', promotional: false
  }, [
    { id: 'a', role: 'derive', width: 1.83, height: 1.2, pentagrama: { total: 38414.63 } },
    { id: 'b', role: 'derive', width: 1.83, height: 2.2, pentagrama: { total: 38414.63 } },
    { id: 'c', role: 'validate', width: 2.5, height: 2.8, pentagrama: { total: 52479 } }
  ]);
  assert.equal(profile.autoApplicable, true);
  assert.equal(profile.proposedRate, 20991.6);
});
