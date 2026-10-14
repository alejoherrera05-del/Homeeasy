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

function mechanismAmbiguityProbes(candidates, limit = 12) {
  const widths = new Set([800, 1300, 1600, 1830, 1900, 2500, 2600, 3000, 3200]);
  const heights = new Set([1000, 1200, 2200, 2800, 3100, 3200, 3500]);
  for (const candidate of candidates || []) {
    for (const band of candidate.bands || []) {
      const width = Number(band.maxWidthMm || 0);
      const height = Number(band.maxHeightMm || 0);
      if (width > 0) [width - 1, width, width + 1].forEach(value => { if (value > 0) widths.add(value); });
      if (height > 0) [height - 1, height, height + 1].forEach(value => { if (value > 0) heights.add(value); });
    }
  }
  const probes = [];
  for (const widthMm of [...widths].sort((a, b) => a - b)) {
    for (const heightMm of [...heights].sort((a, b) => a - b)) {
      const sample = { width: widthMm / 1000, height: heightMm / 1000 };
      const signatures = new Set((candidates || []).map(candidate => mechanismForBands(sample, candidate.bands)));
      if (signatures.size > 1) {
        probes.push({ id: `mechanism-ambiguity-${widthMm}-${heightMm}`, ...sample });
        if (probes.length >= limit) return probes;
      }
    }
  }
  return probes;
}

function genericMechanismProbes(evidence, limit = 12) {
  const existing = new Set((evidence || []).map(item => `${Math.round(Number(item.width) * 1000)}:${Math.round(Number(item.height) * 1000)}`));
  const seeds = [
    [800, 1000], [1300, 2200], [1300, 3500], [1600, 2200], [1830, 2200],
    [1900, 3200], [2500, 2200], [2600, 3200], [3000, 2800], [3200, 3100], [3500, 2000]
  ];
  return seeds
    .filter(([widthMm, heightMm]) => !existing.has(`${widthMm}:${heightMm}`))
    .slice(0, limit)
    .map(([widthMm, heightMm]) => ({ id: `mechanism-discovery-${widthMm}-${heightMm}`, width: widthMm / 1000, height: heightMm / 1000 }));
}

function fabricationAmbiguityProbes(candidates, sourceRules, limit = 12) {
  const widths = new Set([800, 1300, 1830, 1900, 2500, 2600, 3000, 3200, 3500, 4500]);
  const heights = new Set([1000, 1200, 2200, 2800, 3100, 3200, 3500]);
  for (const profile of candidates || []) {
    const rollWidthMm = Number(profile.rollWidthMm || 0);
    if (rollWidthMm > 0) {
      [rollWidthMm - 1, rollWidthMm, rollWidthMm + 1].forEach(value => { if (value > 0) widths.add(value); });
      [rollWidthMm - 1, rollWidthMm, rollWidthMm + 1].forEach(value => { if (value > 0) heights.add(value); });
    }
    for (const band of profile.mechanismBands || []) {
      const width = Number(band.maxWidthMm || 0);
      const height = Number(band.maxHeightMm || 0);
      if (width > 0) [width - 1, width, width + 1].forEach(value => { if (value > 0) widths.add(value); });
      if (height > 0) [height - 1, height, height + 1].forEach(value => { if (value > 0) heights.add(value); });
    }
  }
  const probes = [];
  for (const widthMm of [...widths].sort((a, b) => a - b)) {
    for (const heightMm of [...heights].sort((a, b) => a - b)) {
      const sample = { width: widthMm / 1000, height: heightMm / 1000 };
      const signatures = new Set((candidates || []).map(profile => {
        const result = localFabrication({ rules: { ...(sourceRules || {}), fabricationProfile: profile } }, sample, {});
        return JSON.stringify([result.outcome, result.orientationCode, result.mechanism, result.requiresAuthorization, result.warranty]);
      }));
      if (signatures.size > 1) {
        probes.push({ id: `fabrication-ambiguity-${widthMm}-${heightMm}`, ...sample });
        if (probes.length >= limit) return probes;
      }
    }
  }
  return probes;
}

function learnedMechanismBands(evidence) {
  const points = (evidence || [])
    .filter(item => item && item.outcome !== 'NOT_MANUFACTURABLE' && item.mechanism)
    .map(item => ({
      widthMm: Math.round(Number(item.width) * 1000),
      heightMm: Math.round(Number(item.height) * 1000),
      mechanism: String(item.mechanism)
    }))
    .filter(item => item.widthMm > 0 && item.heightMm > 0 && item.mechanism);

  if (!points.length) return null;

  let remaining = points.map((item, index) => ({ ...item, index }));
  const bands = [];

  for (let step = 0; remaining.length && step < 16; step++) {
    const mechanisms = [...new Set(remaining.map(item => item.mechanism))];
    if (mechanisms.length === 1) {
      bands.push({ maxWidthMm: null, maxHeightMm: null, mechanism: mechanisms[0] });
      remaining = [];
      break;
    }

    let best = null;
    for (const mechanism of mechanisms) {
      const own = remaining.filter(item => item.mechanism === mechanism);
      const widthCandidates = [...new Set(own.map(item => item.widthMm)), null];
      const heightCandidates = [...new Set(own.map(item => item.heightMm)), null];

      for (const maxWidthMm of widthCandidates) {
        for (const maxHeightMm of heightCandidates) {
          if (maxWidthMm === null && maxHeightMm === null) continue;

          const captured = remaining.filter(item =>
            (maxWidthMm === null || item.widthMm <= maxWidthMm) &&
            (maxHeightMm === null || item.heightMm <= maxHeightMm)
          );
          if (!captured.length || captured.some(item => item.mechanism !== mechanism)) continue;

          const constraintCount = Number(maxWidthMm !== null) + Number(maxHeightMm !== null);
          const candidate = {
            mechanism,
            maxWidthMm,
            maxHeightMm,
            captured,
            count: captured.length,
            constraintCount,
            span: (maxWidthMm === null ? 100000 : maxWidthMm) * (maxHeightMm === null ? 100000 : maxHeightMm)
          };

          if (!best ||
              candidate.count > best.count ||
              (candidate.count === best.count && candidate.constraintCount < best.constraintCount) ||
              (candidate.count === best.count && candidate.constraintCount === best.constraintCount && candidate.span > best.span)) {
            best = candidate;
          }
        }
      }
    }

    if (!best) return null;
    bands.push({
      maxWidthMm: best.maxWidthMm,
      maxHeightMm: best.maxHeightMm,
      mechanism: best.mechanism
    });
    const covered = new Set(best.captured.map(item => item.index));
    remaining = remaining.filter(item => !covered.has(item.index));
  }

  if (remaining.length || !bands.length) return null;
  if (!points.every(item => mechanismForBands({ width: item.widthMm / 1000, height: item.heightMm / 1000 }, bands) === item.mechanism)) {
    return null;
  }
  return bands;
}

function learnedMechanismBoundaryProbes(bands, evidence, limit = 12) {
  const existing = new Set((evidence || []).map(item =>
    `${Math.round(Number(item.width) * 1000)}:${Math.round(Number(item.height) * 1000)}`
  ));
  const probes = [];
  const add = (widthMm, heightMm, label) => {
    if (!(widthMm > 0) || !(heightMm > 0)) return;
    const key = `${widthMm}:${heightMm}`;
    if (existing.has(key) || probes.some(item => item._key === key) || probes.length >= limit) return;
    probes.push({ _key: key, id: `mechanism-learned-${label}-${widthMm}-${heightMm}`, width: widthMm / 1000, height: heightMm / 1000 });
  };

  for (let index = 0; index < (bands || []).length && probes.length < limit; index++) {
    const band = bands[index];
    const samples = (evidence || []).filter(item => item && item.mechanism === band.mechanism);
    const widths = [...new Set(samples.map(item => Math.round(Number(item.width) * 1000)).filter(value => value > 0))].sort((a, b) => a - b);
    const heights = [...new Set(samples.map(item => Math.round(Number(item.height) * 1000)).filter(value => value > 0))].sort((a, b) => a - b);
    const representativeHeights = heights.length
      ? [...new Set([heights[0], heights[Math.floor(heights.length / 2)], heights[heights.length - 1]])]
      : [2200];
    const representativeWidths = widths.length
      ? [...new Set([widths[0], widths[Math.floor(widths.length / 2)], widths[widths.length - 1]])]
      : [1300];

    const maxWidthMm = Number(band.maxWidthMm || 0);
    if (maxWidthMm > 0) {
      for (const heightMm of representativeHeights) {
        add(maxWidthMm, heightMm, `w${index + 1}`);
        add(maxWidthMm + 1, heightMm, `w${index + 1}`);
      }
    }

    const maxHeightMm = Number(band.maxHeightMm || 0);
    if (maxHeightMm > 0) {
      for (const widthMm of representativeWidths) {
        add(widthMm, maxHeightMm, `h${index + 1}`);
        add(widthMm, maxHeightMm + 1, `h${index + 1}`);
      }
    }
  }

  return probes.map(({ _key, ...item }) => item);
}

function deriveMechanismBands(evidence, seedProfile, label) {
  const priced = evidence.filter(item => item.outcome !== 'NOT_MANUFACTURABLE' && item.mechanism);
  const matches = mechanismBandCandidates(seedProfile).filter(candidate =>
    priced.every(item => mechanismForBands(item, candidate.bands) === item.mechanism));

  if (matches.length === 1) return matches[0].bands.map(item => ({ ...item }));

  if (matches.length > 1) {
    const ambiguityProbes = mechanismAmbiguityProbes(matches);
    if (!ambiguityProbes.length) return matches[0].bands.map(item => ({ ...item }));
    throw Object.assign(new Error(`${label}: multiple mechanism profiles still match current Live evidence`), {
      code: 'PENTAGRAMA_LOCAL_MODEL_MECHANISM_PROFILE_AMBIGUOUS',
      evidence: priced,
      candidates: matches.map(item => item.id),
      ambiguityProbes
    });
  }

  const mechanisms = [...new Set(priced.map(item => item.mechanism))];
  const widths = new Set(priced.map(item => Math.round(Number(item.width) * 1000)));
  const heights = new Set(priced.map(item => Math.round(Number(item.height) * 1000)));
  if (mechanisms.length === 1 && priced.length >= 6 && widths.size >= 3 && heights.size >= 3) {
    return [{ maxWidthMm: null, maxHeightMm: null, mechanism: mechanisms[0] }];
  }

  const ambiguityProbes = genericMechanismProbes(priced);
  if (mechanisms.length === 1 && ambiguityProbes.length) {
    throw Object.assign(new Error(`${label}: constant mechanism is not yet proven across the fabrication domain`), {
      code: 'PENTAGRAMA_LOCAL_MODEL_MECHANISM_PROFILE_AMBIGUOUS',
      evidence: priced,
      candidates: ['CONSTANT'],
      ambiguityProbes
    });
  }

  const learnedBands = learnedMechanismBands(priced);
  if (learnedBands) {
    const learnedProbes = learnedMechanismBoundaryProbes(learnedBands, priced);
    if (learnedProbes.length) {
      throw Object.assign(new Error(`${label}: learned Live mechanism boundaries require direct edge confirmation`), {
        code: 'PENTAGRAMA_LOCAL_MODEL_MECHANISM_PROFILE_AMBIGUOUS',
        evidence: priced,
        candidates: ['LEARNED_LIVE'],
        learnedBands,
        ambiguityProbes: learnedProbes
      });
    }
    return learnedBands.map(item => ({ ...item }));
  }

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
  if (candidates.length === 1) return candidates[0];

  const ambiguityProbes = fabricationAmbiguityProbes(candidates, sourceRules);
  if (!ambiguityProbes.length) return candidates[0];

  throw Object.assign(new Error(`${group.product.id}: multiple materially different fabrication profiles still match current Live evidence`), {
    code: 'PENTAGRAMA_LOCAL_MODEL_FABRICATION_PROFILE_AMBIGUOUS',
    evidence,
    candidates: candidates.map(item => ({
      rollWidthMm: item.rollWidthMm,
      rotateAtRollWidth: item.rotateAtRollWidth,
      orientationAcrossCode: item.orientationAcrossCode,
      orientationAddedCode: item.orientationAddedCode
    })),
    ambiguityProbes
  });
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
    if (hasExpectedPrice && qa.evidenceSource !== 'Pentagrama Live current run') {
      failures.push({ id: qa.id, code: 'SERIALIZED_EXPECTED_PRICE_NOT_LIVE_CURRENT', evidenceSource: qa.evidenceSource || '' });
      continue;
    }
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
  let baseCurrentLiveChecks = 0;
  let baseLinearityCasesReused = 0;
  let currentTariffChanges = 0;
  const ambiguousProfileLabels = new Set();
  let ambiguityProbeCount = 0;
  const reusingCertifiedBaseLinearity = options.reuseCertifiedBaseLinearity !== false &&
    Number(structuralProfiles.baseLinearityCasesPassed || 0) === 558;

  for (const liveProduct of liveProducts) {
    const product = sourceById.get(liveProduct.homeeasyId);
    const evidence = [];

    const captureBasePrice = async sample => {
      const quote = await options.quoteBase({ homeeasyId: product.id, width: sample.width, height: sample.height, quantity: 1 });
      const total = Number(quote && quote.total);
      if (!(total > 0)) {
        throw Object.assign(new Error(`${product.id}/${sample.id}: invalid Pentagrama total`), {
          code: 'PENTAGRAMA_LOCAL_MODEL_PRICE_UNAVAILABLE'
        });
      }
      baseCurrentLiveChecks++;
      evidence.push({ ...sample, total, rate: inferredRate(product, sample, total), evidenceSource: 'Pentagrama Live current run' });
    };

    await captureBasePrice(BASE_CASES[0]);

    const firstRate = money(evidence[0].rate);
    const persistedRate = Number(product.rate || 0);
    const mayReuseHistoricalLinearity = reusingCertifiedBaseLinearity && persistedRate > 0 && same(firstRate, persistedRate);

    if (mayReuseHistoricalLinearity) {
      baseLinearityCasesReused++;
    } else {
      await captureBasePrice(BASE_CASES[1]);
    }

    const spread = evidence.length > 1
      ? Math.max(...evidence.map(item => item.rate)) - Math.min(...evidence.map(item => item.rate))
      : 0;
    const rate = money(evidence.reduce((sum, item) => sum + item.rate, 0) / evidence.length);
    const productFailures = evidence.filter(item => !same(localTotal(product, rate, item), item.total));

    if ((evidence.length > 1 && spread > TOLERANCE) || productFailures.length) {
      failures.push({ homeeasyId: product.id, code: 'NON_LINEAR_BASE_PRICE', spread: money(spread) });
      continue;
    }

    if (!same(rate, persistedRate)) currentTariffChanges++;

    const rules = normalizeRules(product.rules);
    productPatches.push({
      homeeasyId: product.id, row: product.row, expectedRate: persistedRate, proposedRate: rate,
      expectedRulesHash: hash(rules), rules, source: 'Pentagrama Live current run', method: 'area'
    });

    evidence.forEach(item => qaCases.push({
      id: `${product.id}:${item.id}`,
      homeeasyId: product.id,
      width: item.width,
      height: item.height,
      configuration: 'standard',
      expected: money(item.total),
      scope: 'base',
      evidenceSource: 'Pentagrama Live current run'
    }));

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
      if (captured.has(sampleKey)) return false;
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
        return true;
      }
      const expected = assertLivePrice(live, `${group.product.id}/${sample.id}`);
      const fabrication = fabricationFromLive(live);
      evidence.push({ ...sample, ...fabrication, expected: money(expected) });
      qaCases.push({ id: `${group.product.id}:${sample.id}`, homeeasyId: group.product.id, width: sample.width, height: sample.height,
        configuration: 'standard', expected: money(expected), expectedOutcome: fabrication.outcome, expectedOrientation: fabrication.orientationCode,
        expectedMechanism: fabrication.mechanism, expectedRequiresAuthorization: fabrication.requiresAuthorization,
        expectedWarranty: fabrication.warranty, scope: 'structure', evidenceSource: 'Pentagrama Live current run' });
      return true;
    };
    for (const sample of uniqueStructureCases(seedProfile, group.product.rules || {})) {
      await captureStructure(sample);
    }
    if (failures.length === failureCountBefore) {
      let lowMm = Math.max(...evidence
        .filter(item => Math.round(Number(item.height) * 1000) === 2200 && item.orientationCode === 'DIN')
        .map(item => Math.round(Number(item.width) * 1000)), -Infinity);
      let highMm = Math.min(...evidence
        .filter(item => Math.round(Number(item.height) * 1000) === 2200 && item.orientationCode && item.orientationCode !== 'DIN')
        .map(item => Math.round(Number(item.width) * 1000)), Infinity);
      let probe = 0;

      while (Number.isFinite(lowMm) && Number.isFinite(highMm) && highMm - lowMm > 1 && probe < 20) {
        const widthMm = Math.floor((lowMm + highMm) / 2);
        await captureStructure({ id: `roll-search-mm-${++probe}-${widthMm}`, width: widthMm / 1000, height: 2.2 });
        const found = evidence.find(item =>
          Math.round(Number(item.width) * 1000) === widthMm &&
          Math.round(Number(item.height) * 1000) === 2200);
        if (!found) break;
        if (found.orientationCode === 'DIN') lowMm = widthMm;
        else highMm = widthMm;
      }

      if (Number.isFinite(lowMm) && Number.isFinite(highMm)) {
        for (const widthMm of [lowMm - 1, lowMm, highMm, highMm + 1]) {
          if (widthMm > 0) {
            await captureStructure({ id: `roll-boundary-mm-${widthMm}`, width: widthMm / 1000, height: 2.2 });
          }
        }
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
    let profile = null;
    for (let attempt = 0; attempt < 24 && !profile; attempt++) {
      try {
        profile = deriveFabricationProfile(group, evidence, seedProfile);
      } catch (error) {
        const probes = Array.isArray(error.ambiguityProbes) ? error.ambiguityProbes : [];
        if (probes.length && String(error.code || '').endsWith('_AMBIGUOUS')) {
          ambiguousProfileLabels.add(group.product.id);
          let added = 0;
          for (const probe of probes) {
            if (await captureStructure({ ...probe, id: `${probe.id || 'ambiguity'}-${attempt + 1}` })) {
              added++;
              ambiguityProbeCount++;
            }
          }
          if (added) continue;
        }
        failures.push({ homeeasyId: group.product.id, code: error.code || 'PENTAGRAMA_LOCAL_MODEL_FABRICATION_PROFILE_UNRESOLVED', evidence: error.evidence || evidence });
        break;
      }
    }
    if (!profile) continue;
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
  const resolveSpecialMechanism = async ({ label, parentId, configuration, coverlight, initialSamples, scope, denominator }) => {
    const records = [];
    const seen = new Set();

    const capture = async sample => {
      const sampleKey = `${Math.round(Number(sample.width) * 1000)}:${Math.round(Number(sample.height) * 1000)}`;
      if (seen.has(sampleKey)) return false;
      seen.add(sampleKey);

      const [base, configured] = await Promise.all([
        options.resolveLive({ homeeasyId: parentId, width: sample.width, height: sample.height, quantity: 1, configuration: 'standard' }),
        options.resolveLive({ homeeasyId: parentId, width: sample.width, height: sample.height, quantity: 1, configuration, ...(coverlight ? { coverlight } : {}) })
      ]);

      if (!base || base.ok !== true || !configured || configured.ok !== true ||
          !['PRICE', 'ALTERNATIVE'].includes(base.outcome) || !['PRICE', 'ALTERNATIVE'].includes(configured.outcome)) {
        return false;
      }

      const baseTotal = assertLivePrice(base, `${label}/base`);
      const configuredTotal = assertLivePrice(configured, `${label}/configured`);
      const fabrication = fabricationFromLive(configured);
      const divisor = Number(denominator(sample));
      const rate = divisor > 0 ? money(configuredTotal - baseTotal) / divisor : NaN;

      records.push({ ...sample, configuredTotal: money(configuredTotal), rate, ...fabrication });
      qaCases.push({
        id: `${label}:${scope}-${Math.round(Number(sample.width) * 1000)}-${Math.round(Number(sample.height) * 1000)}`,
        homeeasyId: parentId,
        width: sample.width,
        height: sample.height,
        configuration,
        ...(coverlight ? { coverlight } : {}),
        expected: money(configuredTotal),
        expectedOutcome: fabrication.outcome,
        expectedOrientation: fabrication.orientationCode,
        expectedMechanism: fabrication.mechanism,
        expectedRequiresAuthorization: fabrication.requiresAuthorization,
        expectedWarranty: fabrication.warranty,
        scope,
        evidenceSource: 'Pentagrama Live current run'
      });
      return true;
    };

    for (const sample of initialSamples) await capture(sample);

    const hasBroadMechanismCoverage = () => {
      const widths = new Set(records.map(item => Math.round(Number(item.width) * 1000)));
      const heights = new Set(records.map(item => Math.round(Number(item.height) * 1000)));
      return records.length >= 6 && widths.size >= 3 && heights.size >= 3;
    };

    if (!hasBroadMechanismCoverage()) {
      for (const probe of genericMechanismProbes(records)) {
        if (await capture(probe)) ambiguityProbeCount++;
        if (hasBroadMechanismCoverage()) break;
      }
    }

    if (!hasBroadMechanismCoverage()) {
      ambiguousProfileLabels.add(label);
      throw Object.assign(new Error(`${label}: insufficient Live coverage to certify a special mechanism profile`), {
        code: 'PENTAGRAMA_LOCAL_MODEL_MECHANISM_PROFILE_AMBIGUOUS',
        evidence: records
      });
    }

    let bands = null;
    for (let attempt = 0; attempt < 24 && !bands; attempt++) {
      try {
        bands = deriveMechanismBands(records, null, label);
      } catch (error) {
        const probes = Array.isArray(error.ambiguityProbes) ? error.ambiguityProbes : [];
        if (probes.length && String(error.code || '').endsWith('_AMBIGUOUS')) {
          ambiguousProfileLabels.add(label);
          let added = 0;
          for (const probe of probes) {
            if (await capture(probe)) {
              added++;
              ambiguityProbeCount++;
            }
          }
          if (added) continue;
        }
        throw error;
      }
    }

    if (!bands) {
      throw Object.assign(new Error(`${label}: mechanism profile remains ambiguous after Live probes`), {
        code: 'PENTAGRAMA_LOCAL_MODEL_MECHANISM_PROFILE_AMBIGUOUS'
      });
    }

    const rates = records.map(item => Number(item.rate)).filter(Number.isFinite);
    if (!rates.length || Math.max(...rates) - Math.min(...rates) > TOLERANCE) {
      throw Object.assign(new Error(`${label} is not linear for its configured supplement`), {
        code: 'PENTAGRAMA_LOCAL_MODEL_COMPLEMENT_FAILED'
      });
    }

    return { bands, records, rate: money(rates.reduce((sum, value) => sum + value, 0) / rates.length) };
  };

  for (const supplement of supplementGroups.values()) {
    const parentSpecials = [];
    for (const parentId of supplement.parents) {
      const special = await resolveSpecialMechanism({
        label: `${parentId}/penta13`,
        parentId,
        configuration: 'penta13',
        initialSamples: [{ width: 1.83, height: 2.2 }, { width: 2.5, height: 2.2 }],
        scope: 'penta13',
        denominator: sample => Number(sample.width)
      });
      parentSpecials.push({ parentId, ...special });

      const patch = productPatches.find(item => item.homeeasyId === parentId);
      const configs = Array.isArray(patch.rules.configurations) ? patch.rules.configurations.filter(item => item.id !== 'penta13') : [];
      configs.push({
        id: 'penta13',
        label: supplement.option.label,
        supplementId: supplement.id,
        fabricationMechanismBands: special.bands.map(item => ({ ...item }))
      });
      patch.rules.configurations = configs;
    }

    const rates = parentSpecials.map(item => Number(item.rate));
    if (!rates.length || Math.max(...rates) - Math.min(...rates) > TOLERANCE) {
      throw Object.assign(new Error(`${supplement.id} Penta13 rate differs across parent products`), {
        code: 'PENTAGRAMA_LOCAL_MODEL_COMPLEMENT_FAILED',
        rates: parentSpecials.map(item => ({ parentId: item.parentId, rate: item.rate }))
      });
    }

    const rate = money(rates.reduce((sum, value) => sum + value, 0) / rates.length);
    const existing = sourceById.get(supplement.id);
    const bandHashes = new Set(parentSpecials.map(item => hash(item.bands)));
    const commonBands = bandHashes.size === 1 && parentSpecials.length
      ? parentSpecials[0].bands.map(item => ({ ...item }))
      : [];

    complementPatches.push({ homeeasyId: supplement.id, row: existing && existing.row || null, expectedRate: existing ? Number(existing.rate) : null,
      proposedRate: rate, expectedRulesHash: hash(existing && existing.rules || {}), rules: commonBands.length ? { fabricationMechanismBands: commonBands } : {}, method: 'linear-width',
      family: 'complemento-enrollable', familyName: 'Complementos Enrollable', reference: supplement.option.label,
      type: 'Penta13', configuration: supplement.option.itemCode, source: 'Pentagrama Live current run' });
  }

  for (const [id, definition] of Object.entries(COMPLEMENTS)) {
    const existing = sourceById.get(id);
    if (!existing) throw Object.assign(new Error(`HomeEasy catalog is missing complement ${id}`), { code: 'PENTAGRAMA_LOCAL_MODEL_SOURCE_INCOMPLETE' });

    const special = await resolveSpecialMechanism({
      label: id,
      parentId: matte.id,
      configuration: 'standard',
      coverlight: id,
      initialSamples: [{ width: 1.83, height: 1.2 }, { width: 1.83, height: 2.2 }],
      scope: 'complement',
      denominator: sample => Number(sample.height) * 2
    });
    const specialMechanismBands = special.bands;
    const rate = special.rate;

    const complementRules = normalizeRules(existing.rules);
    complementRules.fabricationMechanismBands = specialMechanismBands;
    const coverlightMechanismBands = normalizeRules(mattePatch.rules.coverlightMechanismBands);
    coverlightMechanismBands[id] = specialMechanismBands.map(item => ({ ...item }));
    mattePatch.rules.coverlightMechanismBands = coverlightMechanismBands;
    complementPatches.push({ homeeasyId: id, row: existing.row, expectedRate: Number(existing.rate), proposedRate: rate,
      expectedRulesHash: hash(existing.rules || {}), rules: complementRules, method: 'linear-height',
      family: existing.family, familyName: existing.familyName, reference: existing.reference, type: existing.type,
      configuration: definition.productCode, source: 'Pentagrama Live current run' });
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
      complements: Object.keys(COMPLEMENTS).length,
      baseCasesLive: baseCurrentLiveChecks,
      baseCurrentLiveChecks,
      baseLinearityCasesReused,
      currentTariffChanges,
      monetaryExpectedLive: qaCases.filter(item => Number(item.expected) > 0 && item.evidenceSource === 'Pentagrama Live current run').length,
      monetaryExpectedSelfReferential: qaCases.filter(item => Number(item.expected) > 0 && item.evidenceSource !== 'Pentagrama Live current run').length,
      structureCasesLive: qaCases.filter(item => item.scope === 'structure').length,
      structureCasesReused: 0,
      ambiguousProfilesDetected: ambiguousProfileLabels.size,
      ambiguityProbes: ambiguityProbeCount,
      ambiguousProfilesRemaining: 0,
      boundaryPrecisionMm: 1,
      penta13FabricationCases: qaCases.filter(item => item.scope === 'penta13').length,
      coverlightFabricationCases: qaCases.filter(item => item.scope === 'complement').length,
      mechanismChanges: structureChanges.filter(item => item.previousMechanism !== item.currentMechanism).length,
      orientationChanges: structureChanges.filter(item => item.previousOrientation !== item.currentOrientation).length,
      structureChanges }
  };
}

module.exports = Object.freeze({ TOLERANCE, BASE_CASES, STRUCTURE_CASES, effectiveArea, localTotal, localFabrication, portalFabricationProfile,
  uniqueStructureCases, deriveMechanismBands, deriveFabricationProfile, mechanismAmbiguityProbes, fabricationAmbiguityProbes, learnedMechanismBands, learnedMechanismBoundaryProbes,
  serializedCandidateQa, structureKey, buildEnrollablesLocalCandidate, hash, same });
