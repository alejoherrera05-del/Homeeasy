'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const liveInventory = require('./enrollables-live-products.json');
const structuralProfiles = require('./enrollables-structural-profiles.json');
const { COMPLEMENTS } = require('./live-resolver');
const { STRUCTURE_CASES, buildEnrollablesLocalCandidate, localFabrication, portalFabricationProfile, serializedCandidateQa } = require('./local-model');

function fixture() {
  const products = Object.values(liveInventory.products);
  const rates = new Map(products.map((item, index) => [item.homeeasyId, 70000 + index * 10]));
  const rules = { sizeRuleId: 'ROLLER_V1', sizeGroup: 'STD', rollWidthMm: 3000, canRotate: true,
    minWidthMm: 500, minHeightMm: 500, coverlightIds: Object.keys(COMPLEMENTS) };
  const sourceProducts = products.map((item, index) => ({
    id: item.homeeasyId, row: index + 2, family: 'enrollable', familyName: 'Enrollable', reference: item.reference,
    type: item.subfamily, method: 'area', rate: rates.get(item.homeeasyId), minHeight: 0, minArea: 1,
    rules: JSON.parse(JSON.stringify(rules)), pricesIncludeVat: true, currency: 'COP', validThrough: '2027-12-31'
  }));
  Object.keys(COMPLEMENTS).forEach((id, index) => sourceProducts.push({ id, row: sourceProducts.length + 2,
    family: 'complemento-enrollable', familyName: 'Complementos Enrollable', reference: id, type: 'Coverlight',
    method: 'linear-height', rate: 10000 + index * 1000, minHeight: 0, minArea: 0, rules: {}, pricesIncludeVat: true, currency: 'COP' }));
  const sizePolicy = { id: 'ROLLER_V1', configurations: { standard: { groups: { STD: [{ maxWidthMm: 5000, maxHeightMm: 4000, mechanism: 'M03', tube: 'STD' }] } } } };
  const base = (id, width, height) => Math.round(Math.max(width * height, 1) * rates.get(id) * 100) / 100;
  const resolveLive = async input => {
    let total = base(input.homeeasyId, Number(input.width), Number(input.height));
    if (input.configuration === 'penta13') total += 150000 * Number(input.width);
    if (input.coverlight) total += (10000 + Object.keys(COMPLEMENTS).indexOf(input.coverlight) * 1000) * Number(input.height) * 2;
    const product = sourceProducts.find(item => item.id === input.homeeasyId);
    const fabrication = localFabrication(product, { width: Number(input.width), height: Number(input.height) }, sizePolicy);
    return { ok: true, outcome: fabrication.outcome, pricing: { total }, configuration: {
      orientationCode: fabrication.orientationCode, mechanism: fabrication.mechanism
    }};
  };
  return {
    source: { version: 'old', validThrough: '2027-12-31', products: sourceProducts, enrollableSizeRules: sizePolicy, config: {} },
    quoteBase: async input => ({ total: base(input.homeeasyId, Number(input.width), Number(input.height)) }),
    resolveLive,
    configurationOptions: async input => ({ penta13: input.homeeasyId === 'enrollable-blackout-matte3'
      ? { itemCode: 'CENPEN13NEG', label: 'PENTA13 NEGRA', calculationType: 'DimensionsWidth' } : null })
  };
}

test('builds one atomic local candidate for all 279 Enrollables', async () => {
  const options = fixture();
  let liveCalls = 0;
  const resolveLive = options.resolveLive;
  options.resolveLive = async input => { liveCalls++; return resolveLive(input); };
  const candidate = await buildEnrollablesLocalCandidate({ ...options, now: '2026-10-11T05:00:00.000Z' });
  assert.equal(candidate.products.length, 279);
  assert.equal(candidate.complements.length, 5);
  assert.equal(candidate.summary.enrollables, 279);
  assert.equal(candidate.summary.structures, 7);
  assert.equal(candidate.summary.fail, 0);
  assert.equal(candidate.summary.maxDifference, 0);
  assert.equal(candidate.summary.penta13, true);
  assert.equal(candidate.summary.complements, 4);
  assert.equal(candidate.summary.baseCasesLive, 0);
  assert.equal(candidate.summary.baseLinearityCasesReused, 558);
  assert.equal(candidate.summary.structureCasesReused, 0);
  assert.equal(candidate.summary.structureCasesLive > candidate.summary.structures * STRUCTURE_CASES.length, true);
  assert.equal(liveCalls >= candidate.summary.structureCasesLive, true);
  assert.equal(candidate.qaCases.filter(item => item.scope === 'structure').every(item => item.evidenceSource === 'Pentagrama Live current run'), true);
  assert.ok(candidate.qaCases.some(item => item.scope === 'penta13'));
  assert.ok(candidate.qaCases.some(item => item.scope === 'complement'));
  assert.ok(candidate.products.find(item => item.homeeasyId === 'enrollable-blackout-matte3').rules.configurations.some(item => item.supplementId));
});

test('current Live evidence replaces stale Angora/Moire profiles and certifies effective Penta13/Coverlight mechanisms', async () => {
  const options = fixture();
  const candidate = await buildEnrollablesLocalCandidate({ ...options, now: '2026-10-11T05:00:00.000Z' });
  for (const homeeasyId of ['enrollable-blackout-angora', 'enrollable-blackout-moireblackout']) {
    const patch = candidate.products.find(item => item.homeeasyId === homeeasyId);
    const product = { ...options.source.products.find(item => item.id === homeeasyId), rules: patch.rules };
    const at183 = localFabrication(product, { width: 1.83, height: 2.2 }, options.source.enrollableSizeRules);
    const at250 = localFabrication(product, { width: 2.5, height: 2.2 }, options.source.enrollableSizeRules);
    assert.equal(at183.orientationCode, 'DIN');
    assert.equal(at183.mechanism, 'M03');
    assert.equal(at250.orientationCode, 'DIN');
    assert.equal(at250.mechanism, 'M03');
    assert.equal(patch.rules.fabricationProfile.source, 'Pentagrama Live current run');
  }
  const matte = candidate.products.find(item => item.homeeasyId === 'enrollable-blackout-matte3');
  const penta13 = matte.rules.configurations.find(item => item.id === 'penta13');
  const configured = { rules: { fabricationProfile: { ...matte.rules.fabricationProfile, mechanismBands: penta13.fabricationMechanismBands } } };
  assert.equal(localFabrication(configured, { width: 1.83, height: 2.2 }, {}).mechanism, 'M03');
  for (const id of Object.keys(COMPLEMENTS)) {
    const withCoverlight = { rules: { fabricationProfile: { ...matte.rules.fabricationProfile, mechanismBands: matte.rules.coverlightMechanismBands[id] } } };
    assert.equal(localFabrication(withCoverlight, { width: 1.83, height: 1.2 }, {}).mechanism, 'M03');
    assert.equal(localFabrication(withCoverlight, { width: 1.83, height: 2.2 }, {}).mechanism, 'M03');
  }
  assert.ok(candidate.qaCases.find(item => item.id === 'enrollable-blackout-matte3:penta13-1.83'));
  assert.ok(candidate.qaCases.find(item => item.id === 'coverlight-standard:1.2'));
  assert.ok(candidate.qaCases.find(item => item.id === 'coverlight-standard:2.2'));
});

test('serialized pre-Apply QA rejects mechanism drift instead of counting qaCases blindly', () => {
  const source = { id: 'p', minArea: 1, minHeight: 0, rules: { fabricationProfile: {
    rollWidthMm: 3000, orientationAcrossCode: 'TAT', orientationAddedCode: 'TAN',
    mechanismBands: [{ maxWidthMm: null, maxHeightMm: null, mechanism: 'M05' }]
  } } };
  const result = serializedCandidateQa(new Map([['p', source]]), [{ homeeasyId: 'p', proposedRate: 100, rules: source.rules }], [], [{
    id: 'p:1.83', homeeasyId: 'p', width: 1.83, height: 2.2, configuration: 'standard', expected: 402.6,
    expectedOutcome: 'PRICE', expectedOrientation: 'DIN', expectedMechanism: 'M03'
  }], {});
  assert.equal(result.pass, 0);
  assert.equal(result.fail, 1);
  assert.equal(result.failures[0].actualMechanism, 'M05');
  assert.equal(result.failures[0].expectedMechanism, 'M03');
});

test('recovers only missing persisted rates without repeating certified base QA', async () => {
  const options = fixture();
  const missing = options.source.products.find(item => item.id === 'enrollable-blackout-felice');
  missing.rate = 0;
  missing.method = 'manual';
  let baseCalls = 0;
  const quoteBase = options.quoteBase;
  options.quoteBase = async input => { baseCalls++; return quoteBase(input); };
  const candidate = await buildEnrollablesLocalCandidate({ ...options, now: '2026-10-11T05:00:00.000Z' });
  const patch = candidate.products.find(item => item.homeeasyId === missing.id);
  assert.equal(baseCalls, 1);
  assert.ok(patch.proposedRate > 0);
  assert.equal(candidate.summary.baseCasesLive, 1);
  assert.equal(candidate.summary.baseLinearityCasesReused, 558);
});

test('rejects a non-linear product instead of approximating its rate', async () => {
  const options = fixture();
  options.reuseCertifiedBaseLinearity = false;
  const original = options.quoteBase;
  options.quoteBase = async input => {
    const quote = await original(input);
    if (input.homeeasyId === 'enrollable-blackout-angora' && Number(input.width) === 1.83) quote.total += 100;
    return quote;
  };
  await assert.rejects(() => buildEnrollablesLocalCandidate(options), error => error.code === 'PENTAGRAMA_LOCAL_MODEL_QA_FAILED');
});

test('reproduces certified Pentagrama orientation and mechanism profiles', () => {
  const cases = [
    ['enrollable-blackout-angora', [
      [0.8, 1, 'DIN', 'M01'], [2.5, 2.2, 'DIN', 'M03'], [3.5, 2, 'TAT', 'M08'], [4.5, 3.2, 'TAN', 'NA']
    ]],
    ['enrollable-blackout-castleblackout', [
      [0.8, 1, 'DIN', 'M01'], [2.5, 2.2, 'DIN', 'M08'], [3.5, 2, 'TAT', 'M08'], [4.5, 3.2, 'TAN', 'NA']
    ]],
    ['enrollable-blackout-florenceblackout', [
      [0.8, 1, 'DIN', 'M01'], [2.5, 2.2, 'TAN', 'M03'], [3.5, 2, 'TAN', 'M08'], [4.5, 3.2, 'TAN', 'NA']
    ]],
    ['enrollable-blackout-mimoblackout', [
      [0.8, 1, 'DIN', 'M01'], [2.5, 2.2, 'TAT', 'M03'], [3.5, 2, 'TAT', 'M08'], [4.5, 3.2, 'TAN', 'NA']
    ]]
  ];
  for (const [homeeasyId, samples] of cases) {
    const profile = portalFabricationProfile(structuralProfiles.profiles[homeeasyId]);
    const product = { rules: { fabricationProfile: profile } };
    for (const [width, height, orientationCode, mechanism] of samples) {
      const result = localFabrication(product, { width, height }, {});
      assert.equal(result.orientationCode, orientationCode, `${homeeasyId}/${width}x${height} orientation`);
      assert.equal(result.mechanism, mechanism, `${homeeasyId}/${width}x${height} mechanism`);
    }
  }
});

test('reproduces the complete Pentagrama structural matrix', () => {
  assert.equal(structuralProfiles.structureKeys, 85);
  assert.equal(structuralProfiles.behaviorProfiles, 9);
  assert.equal(Object.keys(structuralProfiles.profiles).length, 85);
  for (const [homeeasyId, definition] of Object.entries(structuralProfiles.profiles)) {
    const profile = portalFabricationProfile(definition);
    const product = { rules: { fabricationProfile: profile } };
    assert.equal(definition.evidence.length, 4, `${homeeasyId} evidence count`);
    for (const sample of definition.evidence) {
      const result = localFabrication(product, sample, {});
      assert.equal(result.outcome, sample.outcome, `${homeeasyId}/${sample.id} outcome`);
      assert.equal(result.orientationCode, sample.orientationCode, `${homeeasyId}/${sample.id} orientation`);
      assert.equal(result.mechanism, sample.mechanism, `${homeeasyId}/${sample.id} mechanism`);
    }
  }
});
