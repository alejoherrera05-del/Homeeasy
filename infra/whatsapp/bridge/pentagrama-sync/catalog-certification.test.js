'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { INITIAL_MAPPINGS, mappingIsCertified } = require('./mapper');
const { registry, validateCatalogCertification } = require('./catalog-certification');
const { homeEasyRateCost } = require('./strategies');

test('live catalog certification registry is complete and deliberately conservative', () => {
  const summary = validateCatalogCertification(registry);
  assert.deepEqual({
    total: summary.total,
    exactCandidates: summary.exactCandidates,
    ambiguous: summary.ambiguous,
    noCandidate: summary.noCandidate,
    certified: summary.certified,
    reviewRequired: summary.reviewRequired,
    unmapped: summary.unmapped
  }, { total: 452, exactCandidates: 10, ambiguous: 10, noCandidate: 432, certified: 2, reviewRequired: 18, unmapped: 432 });
  assert.deepEqual(summary.certifiedStrategies, {
    RATE_M2: 2, MATRIX: 0, FIXED_PRICE: 0, COMPLEMENT: 0, SPECIAL_CONFIGURATION: 0
  });
});

test('One Click accepts only mappings carrying a complete Pentagrama certificate', () => {
  const accepted = INITIAL_MAPPINGS.filter(mappingIsCertified).map(item => item.homeeasyId).sort();
  assert.deepEqual(accepted, ['onda-67', 'onda-9']);
});

test('Onda Comfort certificate reproduces both normal measures and the billing minimum', () => {
  const source = { method: 'area', minHeight: 1.3, minArea: 1.6, promotional: false, extraDiscount: 0 };
  const rate = 215163.9;
  const cases = [
    { width: 2, height: 2, portal: 860655.6 },
    { width: 2.4, height: 2.1, portal: 1084426.06 },
    { width: 0.8, height: 1, portal: 344262.24 }
  ];
  for (const sample of cases) assert.ok(Math.abs(homeEasyRateCost(rate, source, sample) - sample.portal) <= 0.02);
});

test('mandatory regression controls remain outside unsafe automatic strategies', () => {
  const byId = new Map(registry.products.map(item => [item.homeeasyId, item]));
  assert.equal(byId.get('vertical-111').status, 'REVIEW_REQUIRED');
  assert.equal(byId.get('vertesse-161').status, 'REVIEW_REQUIRED');
  assert.equal(byId.get('enrollable-blackout-matte3').status, 'REVIEW_REQUIRED');
  assert.equal(byId.get('coverlight-standard').status, 'REVIEW_REQUIRED');
});
