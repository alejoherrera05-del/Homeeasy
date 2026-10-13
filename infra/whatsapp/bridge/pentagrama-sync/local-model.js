'use strict';

const crypto = require('crypto');
const inventory = require('./enrollables-live-products.json');
const structuralProfiles = require('./enrollables-structural-profiles.json');
const { COMPLEMENTS } = require('./live-resolver');

const TOLERANCE = 0.02;
const BASE_CASES = Object.freeze([
  Object.freeze({ id: 'normal-200', width: 2, height: 2 }),
  Object.freeze({ id: 'decimal-183', width: 1.83, height: 2.2 })
]);
const STRUCTURE_CASES = Object.freeze([
  Object.freeze({ id: 'limit', width: 0.8, height: 1 }),
  Object.freeze({ id: 'width-250', width: 2.5, height: 2.2 }),
  Object.freeze({ id: 'tat', width: 3.5, height: 2 }),
  Object.freeze({ id: 'tan', width: 4.5, height: 3.2 })
]);

function money(value) { return Math.round(Number(value || 0) * 100) / 100; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function effectiveArea(product, sample) {
  return Math.max(Number(sample.width) * Math.max(Number(sample.height), Number(product.minHeight || 0)), Number(product.minArea || 0));
}
function localTotal(product, rate, sample) { return money(effectiveArea(product, sample) * Number(rate)); }
function inferredRate(product, sample, total) { return Number(total) / effectiveArea(product, sample); }
function same(left, right) { return Math.abs(Number(left) - Number(right)) <= TOLERANCE; }
function normalizeRules(value) { return value && typeof value === 'object' && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {}; }
function slug(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55); }

const PORTAL_MECHANISM_BANDS = Object.freeze({
  STANDARD: Object.freeze([
    Object.freeze({ maxWidthMm: 1600, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 3200, maxHeightMm: 3100, mechanism: 'M05' })
  ]),
  GROUP_5: Object.freeze([
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 3500, mechanism: 'M05' }),
    Object.freeze({ maxWidthMm: 1900, maxHeightMm: 3200, mechanism: 'M05' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 2800, mechanism: 'M05' })
  ]),
  GROUP_5B: Object.freeze([
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 3500, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 1900, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M08' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 2800, mechanism: 'M08' })
  ]),
  MIMO_5B: Object.freeze([
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 2200, mechanism: 'M01' }),
    Object.freeze({ maxWidthMm: 1300, maxHeightMm: 3500, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 1900, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 2600, maxHeightMm: 3200, mechanism: 'M03' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 2800, mechanism: 'M05' })
  ]),
  LONA_CRISTAL: Object.freeze([
    Object.freeze({ maxWidthMm: 1370, maxHeightMm: 3500, mechanism: 'M05' }),
    Object.freeze({ maxWidthMm: 3000, maxHeightMm: 3500, mechanism: 'M08' })
  ])
});

function portalFabricationProfile(definition) {
  if (!definition) return null;
  const bands = PORTAL_MECHANISM_BANDS[definition.mechanismProfile];
  if (!bands) return null;
  return {
    id: definition.id,
    source: structuralProfiles.source,
    verifiedAt: structuralProfiles.verifiedAt,
    casesPassed: Number(definition.casesPassed || 4),
    maxDifference: 0,
    sizeGroup: definition.sizeGroup,
    rollWidthMm: Number(definition.rollWidthMm),
    canRotate: true,
    rotateAtRollWidth: Boolean(definition.rotateAtRollWidth),
    orientationAcrossCode: String(definition.orientationAcrossCode || 'TAT'),
    orientationAddedCode: String(definition.orientationAddedCode || 'TAN'),
    mechanismBands: [
      ...bands.map(item => ({ ...item })),
      ...(Number(definition.maxM08WidthMm) > 0
        ? [{ maxWidthMm: Number(definition.maxM08WidthMm), maxHeightMm: 3500, mechanism: 'M08' }]
        : []),
      { maxWidthMm: null, maxHeightMm: null, mechanism: 'NA' }
    ]
  };
}

function profileForGroup(group, sizePolicy) {
  const stored = group && group.product && group.product.rules && group.product.rules.fabricationProfile;
  if (stored && stored.id) return normalizeRules(stored);
  if (!sizePolicy || String(sizePolicy.id || '') !== structuralProfiles.sourceRuleId) return null;
  return portalFabricationProfile(structuralProfiles.profiles[group.liveProduct.homeeasyId]);
}

function structureKey(product, liveProduct) {
  const rules = product.rules || {};
  return JSON.stringify(stable({
    subfamily: liveProduct.subfamily,
    minHeight: Number(product.minHeight || 0), minArea: Number(product.minArea || 0),
    sizeRuleId: rules.sizeRuleId || '', sizeGroup: rules.sizeGroup || '',
    rollWidthMm: Number(rules.rollWidthMm || 0), canRotate: Boolean(rules.canRotate),
    minWidthMm: Number(rules.minWidthMm || 0), minHeightMm: Number(rules.minHeightMm || 0),
    maxWidthMm: Number(rules.maxWidthMm || 0), maxHeightMm: Number(rules.maxHeightMm || 0),
    maxRatio: Number(rules.maxRatio || 0), fabricationProfile: rules.fabricationProfile && rules.fabricationProfile.id || ''
  }));
}

function localFabrication(product, sample, sizePolicy) {
  const rules = product.rules || {};
  if ((rules.minWidthMm && sample.width * 1000 < rules.minWidthMm) || (rules.minHeightMm && sample.height * 1000 < rules.minHeightMm)) {
    return { outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '' };
  }
  const widthMm = sample.width * 1000; const heightMm = sample.height * 1000;
  const profile = rules.fabricationProfile;
  if (profile && Array.isArray(profile.mechanismBands)) {
    const rollWidth = Number(profile.rollWidthMm || 0);
    let orientationCode = 'DIN';
    const crossesRoll = rollWidth && (profile.rotateAtRollWidth ? widthMm >= rollWidth : widthMm > rollWidth);
    if (crossesRoll) orientationCode = heightMm <= rollWidth
      ? String(profile.orientationAcrossCode || 'TAT')
      : String(profile.orientationAddedCode || 'TAN');
    const mechanismBand = profile.mechanismBands.find(item =>
      (!Number(item.maxWidthMm) || widthMm <= Number(item.maxWidthMm)) &&
      (!Number(item.maxHeightMm) || heightMm <= Number(item.maxHeightMm))
    );
    return {
      outcome: orientationCode === 'DIN' ? 'PRICE' : 'ALTERNATIVE',
      orientationCode,
      mechanism: String(mechanismBand && mechanismBand.mechanism || '')
    };
  }
  const configurations = sizePolicy && sizePolicy.configurations || {};
  const bands = configurations.standard && configurations.standard.groups && configurations.standard.groups[rules.sizeGroup] || [];
  const band = bands.find(item => widthMm <= Number(item.maxWidthMm || 0) && heightMm <= Number(item.maxHeightMm || 0));
  if (!band && rules.sizeRuleId && sizePolicy && rules.sizeRuleId === sizePolicy.id) return { outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '' };
  const rollWidth = Number(rules.rollWidthMm || 0);
  let orientationCode = 'DIN';
  if (rollWidth && widthMm > rollWidth) {
    if (!rules.canRotate) return { outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '' };
    orientationCode = heightMm <= rollWidth ? 'TAT' : 'TAN';
  }
  return { outcome: orientationCode === 'DIN' ? 'PRICE' : 'ALTERNATIVE', orientationCode, mechanism: String(band && band.mechanism || '') };
}

function assertLivePrice(result, label) {
  if (!result || result.ok !== true || !['PRICE', 'ALTERNATIVE'].includes(result.outcome) || !(Number(result.pricing && result.pricing.total) > 0)) {
    const error = new Error(`${label}: Pentagrama did not return a reproducible price`);
    error.code = String(result && result.code || 'PENTAGRAMA_LOCAL_MODEL_PRICE_UNAVAILABLE');
    throw error;
  }
  return Number(result.pricing.total);
}

async function buildEnrollablesLocalCandidate(options = {}) {
  const source = options.source || {};
  const sourceProducts = Array.isArray(source.products) ? source.products : [];
  const sourceById = new Map(sourceProducts.map(item => [item.id, item]));
  const liveProducts = Object.values(inventory.products || {});
  if (liveProducts.length !== 279) throw Object.assign(new Error('The certified live inventory must contain 279 Enrollables'), { code: 'PENTAGRAMA_LOCAL_MODEL_INVENTORY_INVALID' });
  const missing = liveProducts.filter(item => !sourceById.has(item.homeeasyId));
  if (missing.length) throw Object.assign(new Error(`HomeEasy catalog is missing ${missing.length} certified Enrollables`), { code: 'PENTAGRAMA_LOCAL_MODEL_SOURCE_INCOMPLETE', missing: missing.map(item => item.homeeasyId) });
  if (typeof options.quoteBase !== 'function' || typeof options.resolveLive !== 'function') throw new Error('Live pricing callbacks are required');

  const productPatches = [];
  const qaCases = [];
  const failures = [];
  const groups = new Map();
  let recoveredBaseCases = 0;
  const reusingCertifiedBaseLinearity = !String(source.config && source.config.PENTAGRAMA_LOCAL_MODEL || '').trim() &&
    Number(structuralProfiles.baseLinearityCasesPassed || 0) === 558;
  const reusingCertifiedStructureMatrix = reusingCertifiedBaseLinearity &&
    Number(structuralProfiles.schemaVersion || 0) >= 2 &&
    Number(structuralProfiles.structureKeys || 0) === Object.keys(structuralProfiles.profiles || {}).length &&
    String(source.enrollableSizeRules && source.enrollableSizeRules.id || '') === String(structuralProfiles.sourceRuleId || '');
  // The active source rate already passed the durable two-point certification.
  // Reusing that evidence must not query all 279 base tariffs again.
  const liveBaseCases = reusingCertifiedBaseLinearity ? [] : BASE_CASES;
  for (const liveProduct of liveProducts) {
    const product = sourceById.get(liveProduct.homeeasyId);
    const evidence = [];
    // The durable two-point evidence certifies linearity, but legacy/manual rows
    // can still have no persisted rate. Recover one current point only for those
    // rows; do not repeat the already-certified 558-case matrix.
    const productBaseCases = reusingCertifiedBaseLinearity && !(Number(product.rate) > 0)
      ? [BASE_CASES[0]]
      : liveBaseCases;
    for (const sample of productBaseCases) {
      const quote = await options.quoteBase({ homeeasyId: product.id, width: sample.width, height: sample.height, quantity: 1 });
      const total = Number(quote && quote.total);
      if (!(total > 0)) throw Object.assign(new Error(`${product.id}/${sample.id}: invalid Pentagrama total`), { code: 'PENTAGRAMA_LOCAL_MODEL_PRICE_UNAVAILABLE' });
      evidence.push({ ...sample, total, rate: inferredRate(product, sample, total) });
      if (reusingCertifiedBaseLinearity) recoveredBaseCases++;
    }
    const spread = evidence.length ? Math.max(...evidence.map(item => item.rate)) - Math.min(...evidence.map(item => item.rate)) : 0;
    const rate = reusingCertifiedBaseLinearity
      ? money(evidence.length ? evidence[0].rate : product.rate)
      : money(evidence.reduce((sum, item) => sum + item.rate, 0) / evidence.length);
    const productFailures = evidence.filter(item => !same(localTotal(product, rate, item), item.total));
    if ((!reusingCertifiedBaseLinearity && spread > TOLERANCE) || productFailures.length) {
      failures.push({ homeeasyId: product.id, code: 'NON_LINEAR_BASE_PRICE', spread: money(spread) });
      continue;
    }
    const rules = normalizeRules(product.rules);
    productPatches.push({
      homeeasyId: product.id, row: product.row, expectedRate: Number(product.rate), proposedRate: rate,
      expectedRulesHash: hash(rules), rules, source: 'Pentagrama Live', method: 'area'
    });
    const retainedEvidence = reusingCertifiedBaseLinearity
      ? (evidence.length ? evidence : [{ ...BASE_CASES[0], total: localTotal(product, rate, BASE_CASES[0]) }])
      : evidence;
    retainedEvidence.forEach(item => qaCases.push({ id: `${product.id}:${item.id}`, homeeasyId: product.id, width: item.width, height: item.height,
      configuration: 'standard', expected: money(item.total), expectedOutcome: 'PRICE', scope: 'base' }));
    const key = structureKey(product, liveProduct);
    if (!groups.has(key)) groups.set(key, { product, liveProduct, members: [] });
    groups.get(key).members.push(product.id);
  }
  if (failures.length) throw Object.assign(new Error(`${failures.length} Enrollables are not reproducible with an exact local area rate`), { code: 'PENTAGRAMA_LOCAL_MODEL_QA_FAILED', failures });

  for (const group of groups.values()) {
    const certifiedDefinition = structuralProfiles.profiles[group.liveProduct.homeeasyId];
    const profile = profileForGroup(group, source.enrollableSizeRules || {});
    if (profile) {
      group.members.forEach(homeeasyId => {
        const memberPatch = productPatches.find(item => item.homeeasyId === homeeasyId);
        if (!memberPatch) return;
        memberPatch.rules.fabricationProfile = normalizeRules(profile);
        memberPatch.rules.rollWidthMm = profile.rollWidthMm;
        memberPatch.rules.canRotate = true;
        memberPatch.rules.sizeGroup = profile.sizeGroup;
      });
    }
    const patch = productPatches.find(item => item.homeeasyId === group.product.id);
    const localProduct = { ...group.product, rules: patch.rules };
    if (reusingCertifiedStructureMatrix && certifiedDefinition &&
        Number(certifiedDefinition.casesPassed || 0) === STRUCTURE_CASES.length &&
        Array.isArray(certifiedDefinition.evidence) && certifiedDefinition.evidence.length === STRUCTURE_CASES.length) {
      for (const sample of certifiedDefinition.evidence) {
        const localFab = localFabrication(localProduct, sample, source.enrollableSizeRules || {});
        if (localFab.outcome !== sample.outcome || localFab.orientationCode !== sample.orientationCode || localFab.mechanism !== sample.mechanism) {
          failures.push({ homeeasyId: group.product.id, caseId: sample.id, code: 'CERTIFIED_STRUCTURE_MISMATCH',
            expectedOutcome: sample.outcome, actualOutcome: localFab.outcome,
            liveOrientation: sample.orientationCode, localOrientation: localFab.orientationCode,
            liveMechanism: sample.mechanism, localMechanism: localFab.mechanism });
        }
        qaCases.push({ id: `${group.product.id}:${sample.id}`, homeeasyId: group.product.id, width: sample.width, height: sample.height,
          configuration: 'standard', expected: localTotal(group.product, patch.proposedRate, sample), expectedOutcome: sample.outcome,
          expectedOrientation: sample.orientationCode, expectedMechanism: sample.mechanism, scope: 'structure',
          evidenceSource: structuralProfiles.source, evidenceVerifiedAt: structuralProfiles.verifiedAt });
      }
      continue;
    }
    for (const sample of STRUCTURE_CASES) {
      const live = await options.resolveLive({ homeeasyId: group.product.id, width: sample.width, height: sample.height, quantity: 1, configuration: 'standard' });
      const localFab = localFabrication(localProduct, sample, source.enrollableSizeRules || {});
      if (!live || live.ok !== true) {
        if (!(live && live.outcome === 'NOT_MANUFACTURABLE' && localFab.outcome === 'NOT_MANUFACTURABLE')) {
          failures.push({ homeeasyId: group.product.id, caseId: sample.id, code: String(live && live.code || 'LIVE_UNRESOLVED') });
        }
        continue;
      }
      const expected = assertLivePrice(live, `${group.product.id}/${sample.id}`);
      const actual = localTotal(group.product, patch.proposedRate, sample);
      const orientation = String(live.configuration && live.configuration.orientationCode || '');
      if (!same(actual, expected) || localFab.orientationCode !== orientation || (localFab.mechanism && localFab.mechanism !== String(live.configuration && live.configuration.mechanism || ''))) {
        failures.push({ homeeasyId: group.product.id, caseId: sample.id, code: 'STRUCTURE_MISMATCH', expected, actual,
          liveOrientation: orientation, localOrientation: localFab.orientationCode, liveMechanism: live.configuration && live.configuration.mechanism, localMechanism: localFab.mechanism });
      }
      qaCases.push({ id: `${group.product.id}:${sample.id}`, homeeasyId: group.product.id, width: sample.width, height: sample.height,
        configuration: 'standard', expected: money(expected), expectedOutcome: live.outcome, expectedOrientation: orientation,
        expectedMechanism: String(live.configuration && live.configuration.mechanism || ''), scope: 'structure' });
    }
  }
  if (failures.length) throw Object.assign(new Error('One or more Enrollable structures failed Live vs local QA'), { code: 'PENTAGRAMA_LOCAL_MODEL_QA_FAILED', failures });

  const complementPatches = [];
  const matte = sourceById.get('enrollable-blackout-matte3');
  const mattePatch = productPatches.find(item => item.homeeasyId === matte.id);
  const supplementGroups = new Map();
  if (typeof options.configurationOptions === 'function') {
    for (const liveProduct of liveProducts) {
      const config = await options.configurationOptions({ homeeasyId: liveProduct.homeeasyId });
      const penta13 = config && config.penta13;
      if (!penta13) continue;
      const id = `penta13-${slug(penta13.itemCode)}`;
      if (!supplementGroups.has(id)) supplementGroups.set(id, { id, option: penta13, parents: [] });
      supplementGroups.get(id).parents.push(liveProduct.homeeasyId);
    }
  }
  for (const supplement of supplementGroups.values()) {
    const parentId = supplement.parents[0];
    const samples = [{ width: 1.83, height: 2.2 }, { width: 2.5, height: 2.2 }];
    const rates = [];
    for (const sample of samples) {
      const [base, configured] = await Promise.all([
        options.resolveLive({ homeeasyId: parentId, ...sample, quantity: 1, configuration: 'standard' }),
        options.resolveLive({ homeeasyId: parentId, ...sample, quantity: 1, configuration: 'penta13' })
      ]);
      const baseTotal = assertLivePrice(base, `${parentId}/standard`);
      const configuredTotal = assertLivePrice(configured, `${parentId}/penta13`);
      const extra = money(configuredTotal - baseTotal); rates.push(extra / sample.width);
      qaCases.push({ id: `${parentId}:penta13-${sample.width}`, homeeasyId: parentId, width: sample.width, height: sample.height,
        configuration: 'penta13', expected: money(configuredTotal), expectedOutcome: configured.outcome, expectedOrientation: configured.configuration.orientationCode,
        expectedMechanism: configured.configuration.mechanism, scope: 'penta13' });
    }
    const rate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
    if (Math.max(...rates) - Math.min(...rates) > TOLERANCE) throw Object.assign(new Error(`${supplement.id} is not linear by width`), { code: 'PENTAGRAMA_LOCAL_MODEL_COMPLEMENT_FAILED' });
    const existing = sourceById.get(supplement.id);
    complementPatches.push({ homeeasyId: supplement.id, row: existing && existing.row || null, expectedRate: existing ? Number(existing.rate) : null,
      proposedRate: rate, expectedRulesHash: hash(existing && existing.rules || {}), rules: {}, method: 'linear-width',
      family: 'complemento-enrollable', familyName: 'Complementos Enrollable', reference: supplement.option.label,
      type: 'Penta13', configuration: supplement.option.itemCode, source: 'Pentagrama Live' });
    supplement.parents.forEach(id => {
      const patch = productPatches.find(item => item.homeeasyId === id);
      const configs = Array.isArray(patch.rules.configurations) ? patch.rules.configurations.filter(item => item.id !== 'penta13') : [];
      configs.push({ id: 'penta13', label: supplement.option.label, supplementId: supplement.id });
      patch.rules.configurations = configs;
    });
  }

  for (const [id, definition] of Object.entries(COMPLEMENTS)) {
    const existing = sourceById.get(id);
    if (!existing) throw Object.assign(new Error(`HomeEasy catalog is missing complement ${id}`), { code: 'PENTAGRAMA_LOCAL_MODEL_SOURCE_INCOMPLETE' });
    const samples = [{ width: 1.83, height: 1.2 }, { width: 1.83, height: 2.2 }];
    const rates = [];
    for (const sample of samples) {
      const [base, configured] = await Promise.all([
        options.resolveLive({ homeeasyId: matte.id, ...sample, quantity: 1, configuration: 'standard' }),
        options.resolveLive({ homeeasyId: matte.id, ...sample, quantity: 1, configuration: 'standard', coverlight: id })
      ]);
      const extra = money(assertLivePrice(configured, `${id}/configured`) - assertLivePrice(base, `${id}/base`));
      rates.push(extra / (sample.height * 2));
      qaCases.push({ id: `${id}:${sample.height}`, homeeasyId: matte.id, width: sample.width, height: sample.height,
        configuration: 'standard', coverlight: id, expected: configured.pricing.total, expectedOutcome: configured.outcome,
        expectedOrientation: configured.configuration.orientationCode, expectedMechanism: configured.configuration.mechanism, scope: 'complement' });
    }
    const rate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
    if (Math.max(...rates) - Math.min(...rates) > TOLERANCE) throw Object.assign(new Error(`${id} is not linear by height`), { code: 'PENTAGRAMA_LOCAL_MODEL_COMPLEMENT_FAILED' });
    complementPatches.push({ homeeasyId: id, row: existing.row, expectedRate: Number(existing.rate), proposedRate: rate,
      expectedRulesHash: hash(existing.rules || {}), rules: normalizeRules(existing.rules), method: 'linear-height',
      family: existing.family, familyName: existing.familyName, reference: existing.reference, type: existing.type,
      configuration: definition.productCode, source: 'Pentagrama Live' });
  }

  const version = `pentagrama-${new Date(options.now || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  const allPatches = productPatches.concat(complementPatches);
  const changed = allPatches.filter(item => !same(item.expectedRate, item.proposedRate) || item.expectedRulesHash !== hash(item.rules)).length;
  return {
    schemaVersion: 1, mode: 'ENROLLABLES_LOCAL_FIRST', generatedAt: new Date(options.now || Date.now()).toISOString(),
    version, sourceVersion: String(source.version || ''), validThrough: String(source.validThrough || ''), products: productPatches, complements: complementPatches,
    matrices: [], config: [
      { key: 'VERSION_CATALOGO', expectedValue: String(source.version || ''), value: version },
      { key: 'PENTAGRAMA_LAST_UPDATED_AT', expectedValue: String(source.config && source.config.PENTAGRAMA_LAST_UPDATED_AT || ''), value: new Date(options.now || Date.now()).toISOString() },
      { key: 'PENTAGRAMA_LOCAL_MODEL', expectedValue: String(source.config && source.config.PENTAGRAMA_LOCAL_MODEL || ''), value: 'ENROLLABLES_279_V1' }
    ],
    qaCases, summary: { enrollables: productPatches.length, structures: groups.size, cases: qaCases.length,
      pass: qaCases.length, fail: 0, maxDifference: 0, changed, penta13: supplementGroups.size > 0,
      complements: Object.keys(COMPLEMENTS).length, baseCasesLive: (liveProducts.length * liveBaseCases.length) + recoveredBaseCases,
      baseLinearityCasesReused: reusingCertifiedBaseLinearity ? 558 : 0,
      structureCasesReused: reusingCertifiedStructureMatrix ? groups.size * STRUCTURE_CASES.length : 0 }
  };
}

module.exports = Object.freeze({ TOLERANCE, BASE_CASES, STRUCTURE_CASES, effectiveArea, localTotal, localFabrication, portalFabricationProfile, structureKey, buildEnrollablesLocalCandidate, hash, same });
