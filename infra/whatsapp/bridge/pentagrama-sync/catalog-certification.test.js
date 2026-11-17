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
  }, { total: 452, exactCandidates: 160, ambiguous: 12, noCandidate: 280, certified: 157, reviewRequired: 15, unmapped: 280 });
  assert.deepEqual(summary.certifiedStrategies, {
    RATE_M2: 152, MATRIX: 0, FIXED_PRICE: 0, COMPLEMENT: 5, SPECIAL_CONFIGURATION: 0
  });
});

test('One Click accepts only mappings carrying a complete Pentagrama certificate', () => {
  const accepted = INITIAL_MAPPINGS.filter(mappingIsCertified).map(item => item.homeeasyId).sort();
  assert.equal(accepted.length, 131);
  assert.ok(accepted.includes('onda-0'));
  assert.ok(accepted.includes('onda-77'));
  assert.ok(!accepted.includes('onda-10'));
  assert.ok(!accepted.includes('onda-163'));
  assert.ok(accepted.includes('vertical-113'));
  assert.ok(accepted.includes('vertical-118'));
  assert.ok(accepted.includes('vertical-119'));
  assert.ok(accepted.includes('vertical-125'));
  assert.ok(accepted.includes('vertical-126'));
  assert.ok(accepted.includes('vertical-129'));
  assert.ok(accepted.includes('coverlight-standard'));
  assert.ok(accepted.includes('perfil-basico-out'));
  assert.ok(!accepted.includes('vertical-111'));
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
  assert.equal(byId.get('sheer-155').status, 'REVIEW_REQUIRED');
});

test('Complement certificates declare the parent, factor and exact destination', () => {
  const complementIds = ['coverlight-standard', 'coverlight-plus', 'coverlight-advance', 'coverlight-single', 'perfil-basico-out'];
  const mappings = INITIAL_MAPPINGS.filter(item => complementIds.includes(item.homeeasyId));
  assert.equal(mappings.length, 5);
  for (const item of mappings) {
    assert.equal(item.strategy, 'COMPLEMENT');
    assert.equal(item.special.ItemCodeFather, 'ENRSTDBOMA3090');
    assert.equal(item.special.AssociationGroup, 'ENRSTD');
    assert.equal(item.casesPassed, 3);
    assert.equal(item.maxDifference, 0);
  }
  assert.equal(mappings.find(item => item.homeeasyId === 'coverlight-standard').homeeasy.quantity, '2');
  assert.equal(mappings.find(item => item.homeeasyId === 'perfil-basico-out').homeeasy.quantity, '1');
});

test('Onda expansion keeps one exact ProductCode per certified HomeEasy reference', () => {
  const certified = registry.products.filter(item => item.status === 'CERTIFIED' && item.family === 'Onda Serena');
  const codes = certified.map(item => item.productCode);
  assert.equal(certified.length, 77);
  assert.equal(new Set(certified.map(item => item.homeeasyId)).size, 77);
  assert.equal(new Set(codes).size, 77);
  for (const item of certified) {
    assert.equal(item.groupCode, '1345');
    assert.equal(item.calculationType, 'NormalProduct');
    assert.equal(item.casesPassed, 3);
    assert.ok(item.maxDifference <= 0.02);
  }
});

test('Vertical certificates preserve the 1.3m2 billing minimum without forcing 1.6m2', () => {
  const source = { method: 'area', minHeight: 1.3, minArea: 0, promotional: false, extraDiscount: 0 };
  for (const sample of [
    { rate: 103411, width: 2, height: 2, portal: 413644 },
    { rate: 111741, width: 2.4, height: 2.1, portal: 563174.64 },
    { rate: 111741, width: 1, height: 1, portal: 145263.3 },
    { rate: 135541, width: 1, height: 1, portal: 176203.3 }
  ]) assert.ok(Math.abs(homeEasyRateCost(sample.rate, source, sample) - sample.portal) <= 0.02);
});

test('Vertical expansion certifies only exact one-code mappings', () => {
  const vertical = registry.products.filter(item => item.family === 'Verticales');
  const certified = vertical.filter(item => item.status === 'CERTIFIED');
  assert.equal(vertical.length, 21);
  assert.equal(certified.length, 17);
  assert.equal(new Set(certified.map(item => item.productCode)).size, 17);
  assert.equal(vertical.filter(item => item.status === 'REVIEW_REQUIRED').length, 3);
  assert.equal(vertical.filter(item => item.status === 'UNMAPPED').length, 1);
  for (const item of certified) {
    assert.equal(item.strategy, 'RATE_M2');
    assert.equal(item.casesPassed, 3);
    assert.ok(item.maxDifference <= 0.02);
  }
});

test('Panel and Sheer certification keeps only deployable mappings in One Click', () => {
  const panel = registry.products.filter(item => item.family === 'Panel Japonés');
  const sheer = registry.products.filter(item => item.family === 'Sheer Elegance');
  assert.deepEqual({
    certified: panel.filter(item => item.status === 'CERTIFIED').length,
    review: panel.filter(item => item.status === 'REVIEW_REQUIRED').length,
    unmapped: panel.filter(item => item.status === 'UNMAPPED').length
  }, { certified: 32, review: 0, unmapped: 1 });
  assert.deepEqual({
    certified: sheer.filter(item => item.status === 'CERTIFIED').length,
    review: sheer.filter(item => item.status === 'REVIEW_REQUIRED').length,
    unmapped: sheer.filter(item => item.status === 'UNMAPPED').length
  }, { certified: 26, review: 5, unmapped: 1 });
  assert.equal(registry.products.find(item => item.homeeasyId === 'panel-78').casesPassed, 3);
  assert.match(registry.products.find(item => item.homeeasyId === 'panel-78').reason, /1[.,]6 m[2²]/);
  assert.equal(registry.products.find(item => item.homeeasyId === 'panel-78').maintenanceRequired, true);
  assert.equal(registry.products.find(item => item.homeeasyId === 'sheer-131').status, 'CERTIFIED');
  assert.equal(INITIAL_MAPPINGS.filter(item => item.homeeasyId.startsWith('panel-')).length, 32);
  for (const id of ['panel-80', 'panel-83', 'panel-109']) {
    const mapping = INITIAL_MAPPINGS.find(item => item.homeeasyId === id);
    assert.equal(mapping.variants.length, 1);
    assert.equal(mapping.status, 'CERTIFIED');
  }
  assert.ok(!INITIAL_MAPPINGS.some(item => item.homeeasyId.startsWith('sheer-')));
});
