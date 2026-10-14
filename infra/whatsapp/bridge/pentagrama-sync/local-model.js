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
  Object.freeze({ id: 'boundary-130', width: 1.3, height: 2.2 }),
  Object.freeze({ id: 'decimal-183', width: 1.83, height: 2.2 }),
  Object.freeze({ id: 'width-250', width: 2.5, height: 2.2 }),
  Object.freeze({ id: 'mechanism-130-350', width: 1.3, height: 3.5 }),
  Object.freeze({ id: 'mechanism-190-320', width: 1.9, height: 3.2 }),
  Object.freeze({ id: 'mechanism-260-320', width: 2.6, height: 3.2 }),
  Object.freeze({ id: 'mechanism-300-280', width: 3, height: 2.8 }),
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
function cloneValue(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
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

function clonedMechanismBands(profileName) {
  const bands = PORTAL_MECHANISM_BANDS[String(profileName || '')];
  if (!bands) return [];
  return bands.map(item => ({ ...item }));
}

function mechanismForBands(sample, bands) {
  const widthMm = Number(sample && sample.width || 0) * 1000;
  const heightMm = Number(sample && sample.height || 0) * 1000;
  const band = (bands || []).find(item =>
    (!Number(item.maxWidthMm) || widthMm <= Number(item.maxWidthMm)) &&
    (!Number(item.maxHeightMm) || heightMm <= Number(item.maxHeightMm))
  );
  return String(band && band.mechanism || '');
}

function uniqueStructureCases(profile, sourceRules) {
  const cases = STRUCTURE_CASES.map(item => ({ ...item }));
  const rollWidths = [...new Set([
    Number(profile && profile.rollWidthMm || 0), Number(sourceRules && sourceRules.rollWidthMm || 0),
    1300, 1830, 2000, 2500, 2800, 3000, 3200
  ].filter(value => value > 0))];
  for (const rollWidthMm of rollWidths) {
    const rollWidth = rollWidthMm / 1000;
    cases.push({ id: `near-roll-${rollWidthMm}-low`, width: Math.max(0.01, rollWidth - 0.01), height: 2.2 });
    cases.push({ id: `near-roll-${rollWidthMm}-high`, width: rollWidth + 0.01, height: 2.2 });
  }
  const seen = new Set();
  return cases.filter(item => {
    const key = `${Number(item.width).toFixed(3)}:${Number(item.height).toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fabricationFromLive(live) {
  const configuration = live && live.configuration || {};
  const fabrication = live && live.fabrication || {};
  const hasAuthorization = Object.prototype.hasOwnProperty.call(fabrication, 'requiresAuthorization');
  const hasWarranty = Object.prototype.hasOwnProperty.call(fabrication, 'warranty');
  return {
    outcome: String(live && live.outcome || ''),
    orientationCode: String(configuration.orientationCode || fabrication.orientationCode || ''),
    mechanism: String(configuration.mechanism || fabrication.mechanism || ''),
    requiresAuthorization: hasAuthorization ? Boolean(fabrication.requiresAuthorization) : undefined,
    warranty: hasWarranty ? fabrication.warranty !== false : undefined
  };
}

function mechanismBandCandidates(seedProfile) {
  const maxM08 = Number(seedProfile && seedProfile.mechanismBands && seedProfile.mechanismBands.find(item => item.mechanism === 'M08' && item.maxWidthMm) &&
    seedProfile.mechanismBands.find(item => item.mechanism === 'M08' && item.maxWidthMm).maxWidthMm || 3800);
  const candidates = Object.keys(PORTAL_MECHANISM_BANDS).map(name => ({
    id: name,
    bands: [
      ...clonedMechanismBands(name),
      { maxWidthMm: maxM08, maxHeightMm: 3500, mechanism: 'M08' },
      { maxWidthMm: null, maxHeightMm: null, mechanism: 'NA' }
    ]
  }));
  if (seedProfile && Array.isArray(seedProfile.mechanismBands)) {
    candidates.unshift({ id: 'CURRENT', bands: cloneValue(seedProfile.mechanismBands) });
  }
  return candidates;
}

function deriveMechanismBands(evidence, seedProfile, label) {
  const priced = evidence.filter(item => item.outcome !== 'NOT_MANUFACTURABLE' && item.mechanism);
  const matches = mechanismBandCandidates(seedProfile).filter(candidate =>
    priced.every(item => mechanismForBands(item, candidate.bands) === item.mechanism));
  if (matches.length) return matches[0].bands.map(item => ({ ...item }));
  const mechanisms = [...new Set(priced.map(item => item.mechanism))];
  if (mechanisms.length === 1) return [{ maxWidthMm: null, maxHeightMm: null, mechanism: mechanisms[0] }];
  throw Object.assign(new Error(`${label}: current Live mechanisms do not match a reproducible structural profile`), {
    code: 'PENTAGRAMA_LOCAL_MODEL_MECHANISM_PROFILE_UNRESOLVED', evidence: priced
  });
}

function deriveFabricationProfile(group, evidence, seedProfile) {
  const sourceRules = group.product.rules || {};
  const normalWidthsMm = evidence.filter(item => Number(item.height) === 2.2 && item.orientationCode === 'DIN').map(item => Math.round(Number(item.width) * 1000));
  const observedWidthsMm = evidence.filter(item => Number(item.height) === 2.2 && item.orientationCode).map(item => Math.round(Number(item.width) * 1000));
  const rollCandidates = [...new Set([
    Number(sourceRules.rollWidthMm || 0),
    Number(seedProfile && seedProfile.rollWidthMm || 0),
    normalWidthsMm.length ? Math.max(...normalWidthsMm) : 0,
    ...observedWidthsMm,
    1300, 1830, 2000, 2500, 2800, 3000, 3200
  ].filter(value => value > 0))];
  const acrossCodes = [...new Set(evidence.filter(item => item.orientationCode && item.orientationCode !== 'DIN' && !item.orientationCode.startsWith('TAN')).map(item => item.orientationCode))];
  const addedCodes = [...new Set(evidence.filter(item => item.orientationCode && item.orientationCode.startsWith('TAN')).map(item => item.orientationCode))];
  if (!acrossCodes.length) acrossCodes.push(String(seedProfile && seedProfile.orientationAcrossCode || 'TAT'));
  if (!addedCodes.length) addedCodes.push(String(seedProfile && seedProfile.orientationAddedCode || 'TAN'));
  const mechanismBands = deriveMechanismBands(evidence, seedProfile, group.product.id);
  const candidates = [];
  for (const rollWidthMm of rollCandidates) {
    for (const rotateAtRollWidth of [false, true]) {
      for (const orientationAcrossCode of acrossCodes) {
        for (const orientationAddedCode of addedCodes) {
          const profile = {
            id: `live-${slug(group.product.id)}-${rollWidthMm}`,
            source: 'Pentagrama Live current run',
            verifiedAt: new Date().toISOString(),
            casesPassed: evidence.length,
            maxDifference: 0,
            sizeGroup: String(sourceRules.sizeGroup || seedProfile && seedProfile.sizeGroup || ''),
            rollWidthMm, canRotate: true, rotateAtRollWidth,
            orientationAcrossCode, orientationAddedCode,
            mechanismBands
          };
          const product = { rules: { ...sourceRules, fabricationProfile: profile } };
          if (evidence.every(item => {
            const local = localFabrication(product, item, {});
            return local.outcome === item.outcome && local.orientationCode === item.orientationCode &&
              local.mechanism === item.mechanism &&
              (item.requiresAuthorization === undefined || local.requiresAuthorization === item.requiresAuthorization) &&
              (item.warranty === undefined || local.warranty === item.warranty);
          })) candidates.push(profile);
        }
      }
    }
  }
  if (!candidates.length) {
    throw Object.assign(new Error(`${group.product.id}: current Live evidence does not yield one reproducible fabrication profile`), {
      code: 'PENTAGRAMA_LOCAL_MODEL_FABRICATION_PROFILE_UNRESOLVED', evidence
    });
  }
  return candidates[0];
}

function assertSpecialMechanism(samples, liveMechanisms, bands, label) {
  samples.forEach((sample, index) => {
    const expected = String(liveMechanisms[index] || '');
    const local = mechanismForBands(sample, bands);
    if (expected && local !== expected) {
      throw Object.assign(new Error(`${label}/${sample.width}x${sample.height}: special mechanism profile mismatch (${local} != ${expected})`), {
        code: 'PENTAGRAMA_LOCAL_MODEL_SPECIAL_MECHANISM_MISMATCH',
        expectedMechanism: expected,
        localMechanism: local
      });
    }
  });
}

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
  if ((rules.maxWidthMm && widthMm > rules.maxWidthMm) || (rules.maxHeightMm && heightMm > rules.maxHeightMm)) {
    return { outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '' };
  }
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
      mechanism: String(mechanismBand && mechanismBand.mechanism || ''),
      requiresAuthorization: orientationCode.startsWith('TAN') || orientationCode.endsWith('SG'),
      warranty: !orientationCode.startsWith('TAN') && !orientationCode.endsWith('SG')
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
  return { outcome: orientationCode === 'DIN' ? 'PRICE' : 'ALTERNATIVE', orientationCode, mechanism: String(band && band.mechanism || ''),
    requiresAuthorization: orientationCode.startsWith('TAN') || orientationCode.endsWith('SG'),
    warranty: !orientationCode.startsWith('TAN') && !orientationCode.endsWith('SG') };
}

function assertLivePrice(result, label) {
  if (!result || result.ok !== true || !['PRICE', 'ALTERNATIVE'].includes(result.outcome) || !(Number(result.pricing && result.pricing.total) > 0)) {
    const error = new Error(`${label}: Pentagrama did not return a reproducible price`);
    error.code = String(result && result.code || 'PENTAGRAMA_LOCAL_MODEL_PRICE_UNAVAILABLE');
    throw error;
  }
  return Number(result.pricing.total);
}

function serializedCandidateQa(sourceById, productPatches, complementPatches, qaCases, sizePolicy) {
  const products = new Map(productPatches.map(patch => {
    const source = sourceById.get(patch.homeeasyId);
    return [patch.homeeasyId, { ...source, rate: patch.proposedRate, rules: normalizeRules(patch.rules) }];
  }));
  const complements = new Map(complementPatches.map(patch => [patch.homeeasyId, patch]));
  const failures = [];
  let maxDifference = 0;
  for (const qa of qaCases) {
    const base = products.get(qa.homeeasyId);
    if (!base) {
      failures.push({ id: qa.id, code: 'SERIALIZED_PRODUCT_MISSING' });
      continue;
    }
    const product = { ...base, rules: normalizeRules(base.rules) };
    let supplement = null;
    if (qa.configuration && qa.configuration !== 'standard') {
      const variant = (product.rules.configurations || []).find(item => item.id === qa.configuration);
      if (!variant) {
        failures.push({ id: qa.id, code: 'SERIALIZED_CONFIGURATION_MISSING' });
        continue;
      }
      if (Array.isArray(variant.fabricationMechanismBands) && variant.fabricationMechanismBands.length) {
        product.rules.fabricationProfile = { ...(product.rules.fabricationProfile || {}), mechanismBands: cloneValue(variant.fabricationMechanismBands) };
      }
      supplement = complements.get(String(variant.supplementId || '')) || null;
    }
    if (qa.coverlight) {
      const bands = product.rules.coverlightMechanismBands && product.rules.coverlightMechanismBands[qa.coverlight];
      if (Array.isArray(bands) && bands.length) {
        product.rules.fabricationProfile = { ...(product.rules.fabricationProfile || {}), mechanismBands: cloneValue(bands) };
      } else {
        const complement = complements.get(String(qa.coverlight));
        const fallbackBands = complement && complement.rules && complement.rules.fabricationMechanismBands;
        if (Array.isArray(fallbackBands) && fallbackBands.length) {
          product.rules.fabricationProfile = { ...(product.rules.fabricationProfile || {}), mechanismBands: cloneValue(fallbackBands) };
        }
      }
    }
    const sample = { width: Number(qa.width), height: Number(qa.height) };
    const fabrication = localFabrication(product, sample, sizePolicy);
    let actual = localTotal(product, product.rate, sample);
    if (supplement) actual += Number(supplement.proposedRate || 0) * sample.width;
    if (qa.coverlight) {
      const complement = complements.get(String(qa.coverlight));
      if (complement) actual += Number(complement.proposedRate || 0) * sample.height * 2;
    }
    actual = money(actual);
    const hasExpectedPrice = Number(qa.expected) > 0;
    const difference = hasExpectedPrice ? Math.abs(actual - Number(qa.expected)) : 0;
    maxDifference = Math.max(maxDifference, difference);
    const mismatch = (hasExpectedPrice && difference > TOLERANCE) ||
      (qa.expectedOutcome && fabrication.outcome !== qa.expectedOutcome) ||
      (qa.expectedOrientation && fabrication.orientationCode !== qa.expectedOrientation) ||
      (qa.expectedMechanism && fabrication.mechanism !== qa.expectedMechanism) ||
      (qa.expectedRequiresAuthorization !== undefined && fabrication.requiresAuthorization !== qa.expectedRequiresAuthorization) ||
      (qa.expectedWarranty !== undefined && fabrication.warranty !== qa.expectedWarranty);
    if (mismatch) failures.push({
      id: qa.id, code: 'SERIALIZED_PRE_APPLY_MISMATCH', expected: qa.expected, actual, difference: money(difference),
      expectedOutcome: qa.expectedOutcome, actualOutcome: fabrication.outcome,
      expectedOrientation: qa.expectedOrientation, actualOrientation: fabrication.orientationCode,
      expectedMechanism: qa.expectedMechanism, actualMechanism: fabrication.mechanism
    });
  }
  return { cases: qaCases.length, pass: qaCases.length - failures.length, fail: failures.length, maxDifference: money(maxDifference), failures };
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
  const structureChanges = [];
  let recoveredBaseCases = 0;
  const reusingCertifiedBaseLinearity = options.reuseCertifiedBaseLinearity !== false &&
    Number(structuralProfiles.baseLinearityCasesPassed || 0) === 558;
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
    // Historical profiles are probe seeds only. They can never certify a new
    // candidate without fresh Live evidence from this build.
    const seedProfile = profileForGroup(group, source.enrollableSizeRules || {});
    const patch = productPatches.find(item => item.homeeasyId === group.product.id);
    const evidence = [];
    const failureCountBefore = failures.length;
    const captured = new Set();
    const captureStructure = async sample => {
      const sampleKey = `${Number(sample.width).toFixed(3)}:${Number(sample.height).toFixed(3)}`;
      if (captured.has(sampleKey)) return;
      captured.add(sampleKey);
      const live = await options.resolveLive({ homeeasyId: group.product.id, width: sample.width, height: sample.height, quantity: 1, configuration: 'standard' });
      if (!live || live.ok !== true) {
        if (live && live.outcome === 'NOT_MANUFACTURABLE' && live.code === 'PENTAGRAMA_NOT_MANUFACTURABLE') {
          const fabrication = { outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '', requiresAuthorization: undefined, warranty: undefined };
          evidence.push({ ...sample, ...fabrication });
          qaCases.push({ id: `${group.product.id}:${sample.id}`, homeeasyId: group.product.id, width: sample.width, height: sample.height,
            configuration: 'standard', expected: null, expectedOutcome: fabrication.outcome, expectedOrientation: fabrication.orientationCode,
            expectedMechanism: '', scope: 'structure', evidenceSource: 'Pentagrama Live current run' });
        } else {
          failures.push({ homeeasyId: group.product.id, caseId: sample.id, code: String(live && live.code || 'LIVE_UNRESOLVED'), outcome: live && live.outcome });
        }
        return;
      }
      const expected = assertLivePrice(live, `${group.product.id}/${sample.id}`);
      const fabrication = fabricationFromLive(live);
      evidence.push({ ...sample, ...fabrication, expected: money(expected) });
      qaCases.push({ id: `${group.product.id}:${sample.id}`, homeeasyId: group.product.id, width: sample.width, height: sample.height,
        configuration: 'standard', expected: money(expected), expectedOutcome: fabrication.outcome, expectedOrientation: fabrication.orientationCode,
        expectedMechanism: fabrication.mechanism, expectedRequiresAuthorization: fabrication.requiresAuthorization,
        expectedWarranty: fabrication.warranty, scope: 'structure', evidenceSource: 'Pentagrama Live current run' });
    };
    for (const sample of uniqueStructureCases(seedProfile, group.product.rules || {})) {
      await captureStructure(sample);
    }
    if (failures.length === failureCountBefore) {
      let low = Math.max(...evidence.filter(item => Number(item.height) === 2.2 && item.orientationCode === 'DIN').map(item => Number(item.width)), -Infinity);
      let high = Math.min(...evidence.filter(item => Number(item.height) === 2.2 && item.orientationCode && item.orientationCode !== 'DIN').map(item => Number(item.width)), Infinity);
      let probe = 0;
      while (Number.isFinite(low) && Number.isFinite(high) && high - low > 0.011 && probe < 12) {
        const width = Math.round(((low + high) / 2) * 1000) / 1000;
        await captureStructure({ id: `roll-search-${++probe}`, width, height: 2.2 });
        const found = evidence.find(item => Number(item.width) === width && Number(item.height) === 2.2);
        if (!found) break;
        if (found.orientationCode === 'DIN') low = width;
        else high = width;
      }
      if (Number.isFinite(low) && Number.isFinite(high)) {
        const boundaryMm = Math.round(((low + high) / 2) * 100) * 10;
        await captureStructure({ id: 'roll-boundary-confirm', width: boundaryMm / 1000, height: 2.2 });
      }
    }
    if (failures.length > failureCountBefore) continue;
    if (seedProfile) {
      for (const item of evidence) {
        const previous = localFabrication({ rules: { ...(group.product.rules || {}), fabricationProfile: seedProfile } }, item, source.enrollableSizeRules || {});
        if (previous.orientationCode !== item.orientationCode || previous.mechanism !== item.mechanism || previous.outcome !== item.outcome) {
          structureChanges.push({ homeeasyId: group.product.id, caseId: item.id,
            previousOutcome: previous.outcome, currentOutcome: item.outcome,
            previousOrientation: previous.orientationCode, currentOrientation: item.orientationCode,
            previousMechanism: previous.mechanism, currentMechanism: item.mechanism });
        }
      }
    }
    let profile;
    try {
      profile = deriveFabricationProfile(group, evidence, seedProfile);
    } catch (error) {
      failures.push({ homeeasyId: group.product.id, code: error.code || 'PENTAGRAMA_LOCAL_MODEL_FABRICATION_PROFILE_UNRESOLVED', evidence: error.evidence || evidence });
      continue;
    }
    group.members.forEach(homeeasyId => {
      const memberPatch = productPatches.find(item => item.homeeasyId === homeeasyId);
      if (!memberPatch) return;
      memberPatch.rules.fabricationProfile = normalizeRules(profile);
      memberPatch.rules.rollWidthMm = profile.rollWidthMm;
      memberPatch.rules.canRotate = true;
      memberPatch.rules.sizeGroup = profile.sizeGroup;
    });
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
    const liveMechanisms = [];
    for (const sample of samples) {
      const [base, configured] = await Promise.all([
        options.resolveLive({ homeeasyId: parentId, ...sample, quantity: 1, configuration: 'standard' }),
        options.resolveLive({ homeeasyId: parentId, ...sample, quantity: 1, configuration: 'penta13' })
      ]);
      const baseTotal = assertLivePrice(base, `${parentId}/standard`);
      const configuredTotal = assertLivePrice(configured, `${parentId}/penta13`);
      const extra = money(configuredTotal - baseTotal); rates.push(extra / sample.width);
      liveMechanisms.push(String(configured.configuration && configured.configuration.mechanism || ''));
      qaCases.push({ id: `${parentId}:penta13-${sample.width}`, homeeasyId: parentId, width: sample.width, height: sample.height,
        configuration: 'penta13', expected: money(configuredTotal), expectedOutcome: configured.outcome, expectedOrientation: configured.configuration.orientationCode,
        expectedMechanism: configured.configuration.mechanism, scope: 'penta13' });
    }
    const specialMechanismBands = deriveMechanismBands(samples.map((sample, index) => ({ ...sample, outcome: 'PRICE', mechanism: liveMechanisms[index] })), null, `${parentId}/penta13`);
    assertSpecialMechanism(samples, liveMechanisms, specialMechanismBands, `${parentId}/penta13`);
    const rate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
    if (Math.max(...rates) - Math.min(...rates) > TOLERANCE) throw Object.assign(new Error(`${supplement.id} is not linear by width`), { code: 'PENTAGRAMA_LOCAL_MODEL_COMPLEMENT_FAILED' });
    const existing = sourceById.get(supplement.id);
    complementPatches.push({ homeeasyId: supplement.id, row: existing && existing.row || null, expectedRate: existing ? Number(existing.rate) : null,
      proposedRate: rate, expectedRulesHash: hash(existing && existing.rules || {}), rules: { fabricationMechanismBands: specialMechanismBands }, method: 'linear-width',
      family: 'complemento-enrollable', familyName: 'Complementos Enrollable', reference: supplement.option.label,
      type: 'Penta13', configuration: supplement.option.itemCode, source: 'Pentagrama Live' });
    supplement.parents.forEach(id => {
      const patch = productPatches.find(item => item.homeeasyId === id);
      const configs = Array.isArray(patch.rules.configurations) ? patch.rules.configurations.filter(item => item.id !== 'penta13') : [];
      configs.push({
        id: 'penta13',
        label: supplement.option.label,
        supplementId: supplement.id,
        fabricationMechanismBands: specialMechanismBands.map(item => ({ ...item }))
      });
      patch.rules.configurations = configs;
    });
  }

  for (const [id, definition] of Object.entries(COMPLEMENTS)) {
    const existing = sourceById.get(id);
    if (!existing) throw Object.assign(new Error(`HomeEasy catalog is missing complement ${id}`), { code: 'PENTAGRAMA_LOCAL_MODEL_SOURCE_INCOMPLETE' });
    const samples = [{ width: 1.83, height: 1.2 }, { width: 1.83, height: 2.2 }];
    const rates = [];
    const liveMechanisms = [];
    for (const sample of samples) {
      const [base, configured] = await Promise.all([
        options.resolveLive({ homeeasyId: matte.id, ...sample, quantity: 1, configuration: 'standard' }),
        options.resolveLive({ homeeasyId: matte.id, ...sample, quantity: 1, configuration: 'standard', coverlight: id })
      ]);
      const extra = money(assertLivePrice(configured, `${id}/configured`) - assertLivePrice(base, `${id}/base`));
      rates.push(extra / (sample.height * 2));
      liveMechanisms.push(String(configured.configuration && configured.configuration.mechanism || ''));
      qaCases.push({ id: `${id}:${sample.height}`, homeeasyId: matte.id, width: sample.width, height: sample.height,
        configuration: 'standard', coverlight: id, expected: configured.pricing.total, expectedOutcome: configured.outcome,
        expectedOrientation: configured.configuration.orientationCode, expectedMechanism: configured.configuration.mechanism, scope: 'complement' });
    }
    const specialMechanismBands = deriveMechanismBands(samples.map((sample, index) => ({ ...sample, outcome: 'PRICE', mechanism: liveMechanisms[index] })), null, id);
    assertSpecialMechanism(samples, liveMechanisms, specialMechanismBands, id);
    const rate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
    if (Math.max(...rates) - Math.min(...rates) > TOLERANCE) throw Object.assign(new Error(`${id} is not linear by height`), { code: 'PENTAGRAMA_LOCAL_MODEL_COMPLEMENT_FAILED' });
    const complementRules = normalizeRules(existing.rules);
    complementRules.fabricationMechanismBands = specialMechanismBands;
    const coverlightMechanismBands = normalizeRules(mattePatch.rules.coverlightMechanismBands);
    coverlightMechanismBands[id] = specialMechanismBands.map(item => ({ ...item }));
    mattePatch.rules.coverlightMechanismBands = coverlightMechanismBands;
    complementPatches.push({ homeeasyId: id, row: existing.row, expectedRate: Number(existing.rate), proposedRate: rate,
      expectedRulesHash: hash(existing.rules || {}), rules: complementRules, method: 'linear-height',
      family: existing.family, familyName: existing.familyName, reference: existing.reference, type: existing.type,
      configuration: definition.productCode, source: 'Pentagrama Live' });
  }

  const version = `pentagrama-${new Date(options.now || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  const allPatches = productPatches.concat(complementPatches);
  const changed = allPatches.filter(item => !same(item.expectedRate, item.proposedRate) || item.expectedRulesHash !== hash(item.rules)).length;
  const serializedQa = serializedCandidateQa(sourceById, productPatches, complementPatches, qaCases, source.enrollableSizeRules || {});
  if (serializedQa.fail) {
    throw Object.assign(new Error(`${serializedQa.fail} serialized pre-Apply cases failed`), {
      code: 'PENTAGRAMA_LOCAL_MODEL_SERIALIZED_QA_FAILED', failures: serializedQa.failures, summary: serializedQa
    });
  }
  return {
    schemaVersion: 1, mode: 'ENROLLABLES_LOCAL_FIRST', generatedAt: new Date(options.now || Date.now()).toISOString(),
    version, sourceVersion: String(source.version || ''), validThrough: String(source.validThrough || ''), products: productPatches, complements: complementPatches,
    matrices: [], config: [
      { key: 'VERSION_CATALOGO', expectedValue: String(source.version || ''), value: version },
      { key: 'PENTAGRAMA_LAST_UPDATED_AT', expectedValue: String(source.config && source.config.PENTAGRAMA_LAST_UPDATED_AT || ''), value: new Date(options.now || Date.now()).toISOString() },
      { key: 'PENTAGRAMA_LOCAL_MODEL', expectedValue: String(source.config && source.config.PENTAGRAMA_LOCAL_MODEL || ''), value: 'ENROLLABLES_279_V1' }
    ],
    qaCases, summary: { enrollables: productPatches.length, structures: groups.size, cases: serializedQa.cases,
      pass: serializedQa.pass, fail: serializedQa.fail, maxDifference: serializedQa.maxDifference, changed, penta13: supplementGroups.size > 0,
      complements: Object.keys(COMPLEMENTS).length, baseCasesLive: (liveProducts.length * liveBaseCases.length) + recoveredBaseCases,
      baseLinearityCasesReused: reusingCertifiedBaseLinearity ? 558 : 0,
      structureCasesLive: qaCases.filter(item => item.scope === 'structure').length,
      structureCasesReused: 0,
      mechanismChanges: structureChanges.filter(item => item.previousMechanism !== item.currentMechanism).length,
      orientationChanges: structureChanges.filter(item => item.previousOrientation !== item.currentOrientation).length,
      structureChanges }
  };
}

module.exports = Object.freeze({ TOLERANCE, BASE_CASES, STRUCTURE_CASES, effectiveArea, localTotal, localFabrication, portalFabricationProfile,
  uniqueStructureCases, deriveMechanismBands, deriveFabricationProfile, serializedCandidateQa, structureKey, buildEnrollablesLocalCandidate, hash, same });
