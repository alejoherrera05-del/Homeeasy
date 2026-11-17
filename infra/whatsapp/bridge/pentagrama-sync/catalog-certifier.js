'use strict';

const structuralProfiles = require('./enrollables-structural-profiles.json');
const {
  STRUCTURE_CASES,
  fabricationAmbiguityProbes,
  localFabrication,
  portalFabricationProfile
} = require('./local-model');

const RING_CONFIGURATION = 'Sistema Ring al 2.0 · tubo con anillos. Configuración Pentagrama: color de anillos, recogida, altura de confección, bajo, dirección de tela y correa opcional.';
const RING_NOTE = 'Sistema Ring al 2.0. Define color de anillos, recogida, altura de confección, bajo y dirección de tela según el pedido.';
const RING_SAMPLES = Object.freeze([
  Object.freeze({ id: 'small', width: 0.60, height: 1.00 }),
  Object.freeze({ id: 'square', width: 1.00, height: 1.00 }),
  Object.freeze({ id: 'large', width: 1.83, height: 2.20 })
]);

function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }
function normalized(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }
function roundMoney(value) { return Math.round(Number(value) * 100) / 100; }
function roundRate(value) { return Math.round(Number(value) * 10000) / 10000; }
function slug(value) { return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

const ENROLLABLE_PRICE_SAMPLES = Object.freeze([
  Object.freeze({ id: 'minimum', width: 0.8, height: 1 }),
  Object.freeze({ id: 'square', width: 1, height: 1 }),
  Object.freeze({ id: 'low-height', width: 1.5, height: 0.5 }),
  Object.freeze({ id: 'normal', width: 2, height: 2 }),
  Object.freeze({ id: 'decimal', width: 1.83, height: 2.2 })
]);

const ENROLLABLE_CONFIGURATIONS = Object.freeze([
  Object.freeze({ id: 'standard', label: 'Manual · standard · sin cabezal', method: 'area' }),
  Object.freeze({ id: 'lujo', label: 'Perfil de lujo', method: 'manual' }),
  Object.freeze({ id: 'cabezal-3', label: 'Cabezal 3 pulgadas', method: 'manual' }),
  Object.freeze({ id: 'cabezal-4', label: 'Cabezal 4 pulgadas', method: 'manual' }),
  Object.freeze({ id: 'renueva', label: 'Renueva', method: 'manual' }),
  Object.freeze({ id: 'motor', label: 'Motorizada', method: 'manual' }),
  Object.freeze({ id: 'especial', label: 'Tubo, mecanismo, impresión o sistema especial', method: 'manual' })
]);

function titleReference(value) {
  return text(value).toLowerCase().replace(/(^|[\s-])([a-záéíóúñ])/g, (match, lead, letter) => lead + letter.toUpperCase())
    .replace(/\bBlack Out\b/i, 'Blackout');
}

function enrollableType(route) {
  const value = normalized([route && route.groupName, route && route.referenceName].join(' '));
  if (/BLACK\s*OUT|BLACKOUT/.test(value)) return 'Blackout';
  if (/TRASLUC/.test(value)) return 'Traslúcido';
  if (/SCREEN/.test(value)) return 'Screen';
  if (/VELO/.test(value)) return 'Velo';
  return titleReference(route && route.groupName) || 'Enrollable';
}

function homeeasyIdForEnrollableRoute(route) {
  const type = slug(enrollableType(route)).replace(/-/g, '');
  const reference = slug(route && route.referenceName).replace(/-/g, '');
  if (!reference) throw Object.assign(new Error('Enrollable route has no reference name'), { code: 'PENTAGRAMA_ENROLLABLE_REFERENCE_REQUIRED' });
  return `enrollable-${type}-${reference}`;
}

function dynamicProductSpec(route, product, homeeasyId) {
  return {
    homeeasyId,
    reference: titleReference(route && route.referenceName),
    name: text(product && product.name),
    productCode: text(product && product.productCode),
    groupCode: text(product && product.groupCode),
    associationGroup: text(product && product.associationGroup),
    primaryGroup: text(product && product.primaryGroup) || 'ENROLLABLE',
    calculationType: text(product && product.calculationType) || 'NormalProduct',
    unit: text(product && product.unit) || 'UND',
    discount: Number(product && product.discount || 0),
    system: 'STANDARD/PLATINA SIN CABEZAL',
    categories: { ...(route && route.categories || product && product.categories || {}) }
  };
}

function fabricationFromResolved(result, sample) {
  if (result && result.outcome === 'NOT_MANUFACTURABLE') {
    return { ...sample, outcome: 'NOT_MANUFACTURABLE', orientationCode: 'NAN', mechanism: '' };
  }
  const configuration = result && result.configuration || {};
  const fabrication = result && result.fabrication || {};
  return {
    ...sample,
    outcome: text(result && result.outcome) || 'PRICE',
    orientationCode: text(configuration.orientationCode || fabrication.orientationCode),
    mechanism: text(configuration.mechanism || fabrication.mechanism),
    requiresAuthorization: fabrication.requiresAuthorization,
    warranty: fabrication.warranty
  };
}

function structuralCandidates() {
  const bySignature = new Map();
  Object.values(structuralProfiles.profiles || {}).forEach(definition => {
    const profile = portalFabricationProfile(definition);
    if (!profile) return;
    const signature = JSON.stringify({
      sizeGroup: profile.sizeGroup,
      rollWidthMm: profile.rollWidthMm,
      rotateAtRollWidth: profile.rotateAtRollWidth,
      orientationAcrossCode: profile.orientationAcrossCode,
      orientationAddedCode: profile.orientationAddedCode,
      mechanismBands: profile.mechanismBands
    });
    if (!bySignature.has(signature)) bySignature.set(signature, profile);
  });
  return [...bySignature.values()];
}

function matchesFabrication(profile, evidence, rules = {}) {
  const product = { rules: { ...rules, fabricationProfile: profile } };
  return evidence.every(item => {
    const local = localFabrication(product, item, {});
    return local.outcome === item.outcome && local.orientationCode === item.orientationCode && local.mechanism === item.mechanism &&
      (item.requiresAuthorization === undefined || local.requiresAuthorization === item.requiresAuthorization) &&
      (item.warranty === undefined || local.warranty === item.warranty);
  });
}

function inferAreaModel(evidence, tolerance) {
  const minHeights = [0, 0.4, 0.5, 1];
  const minAreas = [0, 0.5, 0.8, 1];
  const candidates = [];
  for (const minHeight of minHeights) {
    for (const minArea of minAreas) {
      const rates = evidence.map(item => item.total / Math.max(item.width * Math.max(item.height, minHeight), minArea));
      const rate = roundRate(rates.reduce((sum, value) => sum + value, 0) / rates.length);
      if (evidence.every(item => Math.abs(roundMoney(rate * Math.max(item.width * Math.max(item.height, minHeight), minArea)) - item.total) <= tolerance)) {
        candidates.push({ minHeight, minArea, rate });
      }
    }
  }
  const exact = candidates.sort((left, right) => right.minArea - left.minArea || right.minHeight - left.minHeight);
  return exact[0] || null;
}

function ringType(live) {
  const haystack = normalized([...(live && live.path || []), live && live.name].join(' '));
  if (/BLACK\s*OUT|BLACKOUT/.test(haystack)) return 'Blackout';
  if (/TRASLUC/.test(haystack)) return 'Traslúcido';
  if (/\bVELO\b/.test(haystack)) return 'Velo';
  return '';
}

function isRenueva(live) {
  return /\bRENUEVA\b/.test(normalized([...(live && live.path || []), live && live.name].join(' ')));
}

function isRing(live) {
  const path = normalized((live && live.path || []).join(' > '));
  return /CORTINA\s+RING/.test(path) &&
    normalized(live && live.associationGroup) === 'RIECORIN' &&
    normalized(live && live.groupCode) === '1346' &&
    normalized(live && live.calculationType) === 'NORMALPRODUCT' &&
    normalized(live && live.unit) === 'MT2';
}

function referenceName(live) {
  let name = text(live && live.name);
  name = name
    .replace(/^Cortina\s+Ring(?:\s+al\s+2[.,]0)?\s*/i, '')
    .replace(/^(?:Black\s*Out|Blackout|Trasl[uú]cido|Velo)\s+/i, '')
    .trim();
  return name || text(live && live.name);
}

function homeeasyIdForRing(live) {
  const code = text(live && live.productCode).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!code) throw Object.assign(new Error('Ring product has no ProductCode'), { code: 'PENTAGRAMA_RING_PRODUCT_CODE_REQUIRED' });
  return 'ring-' + code;
}

function priceParams(live, sample) {
  return {
    ProductCode: text(live.productCode),
    Quantity: 1,
    Width: String(sample.width),
    Height: String(sample.height),
    GroupCode: text(live.groupCode),
    calculationType: text(live.calculationType || 'NormalProduct'),
    Degrees: '',
    Panels: 0,
    Cabezal: '',
    ItemCodeFather: '',
    AssociationGroup: text(live.associationGroup)
  };
}

function sourceRowValues(sourceProduct, sourceCatalog, overrides = {}) {
  const external = sourceProduct && sourceProduct.external || {};
  const rules = {
    source: text(external.source || 'PENTAGRAMA_LIVE'),
    sourceSha256: text(external.sourceSha256),
    productCode: text(external.productCode),
    groupCode: text(external.groupCode),
    associationGroup: text(external.associationGroup),
    primaryGroup: text(external.primaryGroup),
    calculationType: text(external.calculationType || 'NormalProduct'),
    unit: text(external.unit || 'MT2'),
    note: RING_NOTE
  };
  return [
    text(overrides.id || sourceProduct.id),
    text(overrides.family || sourceProduct.family || 'ring'),
    text(overrides.familyName || sourceProduct.familyName || 'Cortina Ring'),
    text(overrides.reference || sourceProduct.reference),
    text(overrides.type || sourceProduct.type),
    text(overrides.method || sourceProduct.method || 'area'),
    Number(overrides.rate !== undefined ? overrides.rate : sourceProduct.rate || 0),
    Number(sourceProduct.minHeight || 0),
    Number(sourceProduct.minArea || 0),
    Number(sourceProduct.extraDiscount || 0),
    Boolean(sourceProduct.promotional),
    text(sourceProduct.configuration || RING_CONFIGURATION),
    overrides.active !== undefined ? Boolean(overrides.active) : sourceProduct.active !== false,
    text(overrides.status || sourceProduct.status || 'VIGENTE'),
    text(sourceCatalog && sourceCatalog.validThrough),
    text(sourceCatalog && sourceCatalog.version),
    'COP',
    true,
    'Pentagrama Live',
    '',
    JSON.stringify({ ...rules, ...(overrides.rules || {}) })
  ];
}

class CatalogCertifier {
  constructor(options = {}) {
    if (!options.pricing || typeof options.pricing.supplierCost !== 'function') {
      throw new TypeError('CatalogCertifier requires Pentagrama pricing');
    }
    this.pricing = options.pricing;
    this.gateway = options.gateway || null;
    this.tolerance = Number.isFinite(Number(options.tolerance)) ? Number(options.tolerance) : 0.02;
  }

  async resolveEnrollable(productSpec, sample) {
    if (!this.gateway || typeof this.gateway.dispatch !== 'function') {
      throw Object.assign(new Error('Dynamic Enrollable certification requires the Pentagrama Agent'), { code: 'AGENT_OFFLINE' });
    }
    return this.gateway.dispatch('resolveLivePrice', {
      productSpec,
      width: sample.width,
      height: sample.height,
      quantity: 1,
      configuration: 'standard'
    }, { lockKey: `dynamic-enrollable:${productSpec.productCode}:${sample.width}:${sample.height}` });
  }

  async certifyEnrollableRoute(route, sourceCatalog = {}) {
    const products = Array.isArray(route && route.products) ? route.products.filter(item => text(item && item.productCode)) : [];
    if (!products.length || normalized(products[0].associationGroup) !== 'ENRSTD') {
      return { ok: false, status: 'REVIEW_REQUIRED', reason: 'La ruta nueva no contiene identidades Standard de Enrollables.' };
    }
    if (products.some(item => normalized(item.associationGroup) !== 'ENRSTD')) {
      return { ok: false, status: 'REVIEW_REQUIRED', reason: 'La ruta mezcla sistemas de fabricación diferentes.' };
    }

    const homeeasyId = homeeasyIdForEnrollableRoute(route);
    const preferred = products.find(item => /(?:BLA|WHI|WHITE|BLANCO)/i.test(text(item.productCode) + ' ' + text(item.name))) || products[0];
    const productSpec = dynamicProductSpec(route, preferred, homeeasyId);
    const priceEvidence = [];
    for (const sample of ENROLLABLE_PRICE_SAMPLES) {
      const result = await this.resolveEnrollable(productSpec, sample);
      const total = Number(result && result.pricing && result.pricing.total);
      if (!result || result.ok !== true || !(total > 0)) {
        return { ok: false, status: 'REVIEW_REQUIRED', reason: `Pentagrama no entregó precio fabricable para ${sample.id}.`, evidence: priceEvidence };
      }
      priceEvidence.push({ ...sample, total: roundMoney(total) });
    }

    const model = inferAreaModel(priceEvidence, this.tolerance);
    if (!model || !(model.rate > 0)) {
      return { ok: false, status: 'REVIEW_REQUIRED', reason: 'Los precios no forman una regla exacta de área, alto mínimo y área mínima.', evidence: priceEvidence };
    }

    const variantEvidence = [];
    for (const product of products) {
      const spec = dynamicProductSpec(route, product, homeeasyId);
      for (const sample of [ENROLLABLE_PRICE_SAMPLES[0], ENROLLABLE_PRICE_SAMPLES[4]]) {
        const result = await this.resolveEnrollable(spec, sample);
        const total = Number(result && result.pricing && result.pricing.total);
        const expected = roundMoney(model.rate * Math.max(sample.width * Math.max(sample.height, model.minHeight), model.minArea));
        variantEvidence.push({ productCode: spec.productCode, ...sample, total: roundMoney(total), expected });
        if (!result || result.ok !== true || !(total > 0) || Math.abs(roundMoney(total) - expected) > this.tolerance) {
          return { ok: false, status: 'REVIEW_REQUIRED', reason: `La variante ${spec.productCode} no comparte la tarifa certificada de la ruta.`, evidence: variantEvidence };
        }
      }
    }

    const structuralEvidence = [];
    const captured = new Set();
    const captureStructure = async sample => {
      const key = `${Number(sample.width).toFixed(3)}:${Number(sample.height).toFixed(3)}`;
      if (captured.has(key)) return;
      captured.add(key);
      const result = await this.resolveEnrollable(productSpec, sample);
      if (!result || (result.ok !== true && result.outcome !== 'NOT_MANUFACTURABLE')) {
        throw Object.assign(new Error(`Pentagrama no resolvió fabricación para ${sample.id || key}`), { code: result && result.code || 'PENTAGRAMA_CONFIGURATION_UNRESOLVED' });
      }
      structuralEvidence.push(fabricationFromResolved(result, sample));
    };
    for (const sample of STRUCTURE_CASES) await captureStructure(sample);

    const sourceRules = { minWidthMm: 250, minHeightMm: 400 };
    let candidates = structuralCandidates().filter(profile => matchesFabrication(profile, structuralEvidence, sourceRules));
    for (let attempt = 0; candidates.length > 1 && attempt < 8; attempt++) {
      const probes = fabricationAmbiguityProbes(candidates, sourceRules, 12);
      if (!probes.length) break;
      for (const probe of probes) await captureStructure({ ...probe, id: `${probe.id || 'ambiguity'}-${attempt + 1}` });
      candidates = candidates.filter(profile => matchesFabrication(profile, structuralEvidence, sourceRules));
    }
    if (candidates.length !== 1) {
      return {
        ok: false,
        status: 'REVIEW_REQUIRED',
        reason: candidates.length ? 'La fabricación coincide con más de un perfil y requiere más evidencia.' : 'La fabricación no coincide con ningún perfil certificado de Enrollables.',
        evidence: structuralEvidence,
        candidateCount: candidates.length
      };
    }

    const certifiedAt = new Date().toISOString();
    const profile = {
      ...candidates[0],
      id: `live-${slug(homeeasyId)}-${Number(candidates[0].rollWidthMm || 0)}`,
      source: 'Pentagrama Live dynamic route certification',
      verifiedAt: certifiedAt,
      casesPassed: structuralEvidence.length,
      maxDifference: 0
    };
    const reference = titleReference(route.referenceName);
    const type = enrollableType(route);
    const rules = {
      source: 'PENTAGRAMA_LIVE_DYNAMIC',
      certifiedAt,
      routeKey: text(route.routeKey),
      categories: { ...(route.categories || {}) },
      productCode: productSpec.productCode,
      groupCode: productSpec.groupCode,
      associationGroup: productSpec.associationGroup,
      primaryGroup: productSpec.primaryGroup,
      calculationType: productSpec.calculationType,
      unit: productSpec.unit,
      variants: products.map(product => ({
        productCode: text(product.productCode),
        groupCode: text(product.groupCode),
        associationGroup: text(product.associationGroup),
        name: text(product.name)
      })),
      configurations: ENROLLABLE_CONFIGURATIONS.map(item => ({ ...item })),
      minWidthMm: 250,
      minHeightMm: 400,
      priceBasis: 'Neto distribuidor + IVA; no descontar otra vez',
      conditions: 'Fabricación automática certificada contra Pentagrama Live. Atravesada y añadida exige autorización y puede quedar sin garantía. Motores, impresión, cabezales y accesorios especiales requieren costo confirmado.',
      coverlightIds: ['coverlight-standard', 'coverlight-plus', 'coverlight-advance', 'coverlight-single'],
      sizeRuleId: String(structuralProfiles.sourceRuleId || ''),
      sizeGroup: text(profile.sizeGroup),
      rollWidthMm: Number(profile.rollWidthMm || 0),
      canRotate: true,
      fabricationProfile: profile,
      evidence: {
        prices: priceEvidence.map(item => ({ id: item.id, width: item.width, height: item.height, total: item.total })),
        fabricationCases: structuralEvidence.length,
        variants: products.length
      }
    };
    const rowValues = [
      homeeasyId, 'enrollable', 'Enrollable', reference, type, 'area', model.rate,
      model.minHeight, model.minArea, 0, false, 'Manual · sin cabezal · enrolle normal', true, 'VIGENTE',
      text(sourceCatalog.validThrough), text(sourceCatalog.version), 'COP', true,
      'Pentagrama Live', '', JSON.stringify(rules)
    ];
    const qaCases = priceEvidence.map(item => ({
      id: item.id,
      width: String(item.width),
      height: String(item.height),
      quantity: 1,
      expected: item.total,
      homeeasy: { product: homeeasyId, width: String(item.width), height: String(item.height), quantity: '1', extras: '0', configuration: 'standard' }
    }));
    return {
      ok: true,
      status: 'CERTIFIED',
      family: 'enrollable',
      homeeasyId,
      reference,
      type,
      rate: model.rate,
      minHeight: model.minHeight,
      minArea: model.minArea,
      externalKey: `ENROLLABLE_ROUTE:${text(route.routeKey)}`,
      representative: productSpec,
      products: products.map(product => dynamicProductSpec(route, product, homeeasyId)),
      rowValues,
      qaCases,
      evidence: { prices: priceEvidence, variants: variantEvidence, fabrication: structuralEvidence },
      rules
    };
  }

  async probeRing(live) {
    if (!isRing(live)) return { ok: false, status: 'REVIEW_REQUIRED', reason: 'La referencia no pertenece al perfil técnico certificado de Cortina Ring.' };
    if (isRenueva(live)) return { ok: false, status: 'EXCLUDED', reason: 'La familia Renueva está excluida de HomeEasy.' };
    const type = ringType(live);
    if (!type) return { ok: false, status: 'REVIEW_REQUIRED', reason: 'No se pudo resolver el tipo de Cortina Ring.' };
    const sample = RING_SAMPLES.find(item => item.id === 'square');
    const cost = await this.pricing.supplierCost(priceParams(live, sample), {
      pricingMode: 'account-discount',
      productDiscount: Number(live.discount || 0),
      AssociationGroup: text(live.associationGroup)
    });
    const total = Number(cost && cost.total);
    if (!Number.isFinite(total) || total <= 0) {
      return { ok: false, status: 'REVIEW_REQUIRED', reason: 'Pentagrama devolvió una tarifa vacía o COP 0.' };
    }
    return {
      ok: true,
      status: 'PROBED',
      type,
      reference: referenceName(live),
      rate: roundRate(total),
      evidence: {
        id: sample.id,
        width: sample.width,
        height: sample.height,
        total: roundMoney(total),
        basePrice: Number(cost.basePrice || 0),
        distributorDiscount: Number(cost.distributorDiscount || 0),
        productDiscount: Number(cost.productDiscount || 0),
        vatRate: Number(cost.vatRate || 0)
      }
    };
  }

  async certifyRing(live, sourceCatalog = {}) {
    if (!isRing(live)) return { ok: false, status: 'REVIEW_REQUIRED', reason: 'La referencia no pertenece al perfil técnico certificado de Cortina Ring.' };
    if (isRenueva(live)) return { ok: false, status: 'EXCLUDED', reason: 'La familia Renueva está excluida de HomeEasy.' };
    const type = ringType(live);
    if (!type) return { ok: false, status: 'REVIEW_REQUIRED', reason: 'No se pudo resolver el tipo Velo, Traslúcido o Blackout desde Pentagrama.' };

    const evidence = [];
    for (const sample of RING_SAMPLES) {
      const cost = await this.pricing.supplierCost(priceParams(live, sample), {
        pricingMode: 'account-discount',
        productDiscount: Number(live.discount || 0),
        AssociationGroup: text(live.associationGroup)
      });
      const total = Number(cost && cost.total);
      if (!Number.isFinite(total) || total <= 0) {
        return { ok: false, status: 'REVIEW_REQUIRED', reason: 'Pentagrama devolvió una tarifa vacía o COP 0.', evidence };
      }
      const area = Number(sample.width) * Number(sample.height);
      evidence.push({
        id: sample.id,
        width: sample.width,
        height: sample.height,
        total: roundMoney(total),
        rate: roundRate(total / area),
        basePrice: Number(cost.basePrice || 0),
        distributorDiscount: Number(cost.distributorDiscount || 0),
        productDiscount: Number(cost.productDiscount || 0),
        vatRate: Number(cost.vatRate || 0)
      });
    }

    const rate = evidence.find(item => item.id === 'square').rate;
    const failures = evidence.filter(item => Math.abs(roundMoney(rate * item.width * item.height) - item.total) > this.tolerance);
    if (failures.length) {
      return {
        ok: false,
        status: 'REVIEW_REQUIRED',
        reason: 'La tarifa no reproduce de forma lineal los precios reales de Pentagrama.',
        evidence,
        failures: failures.map(item => item.id)
      };
    }

    const id = homeeasyIdForRing(live);
    const ref = referenceName(live);
    const certifiedAt = new Date().toISOString();
    const rules = {
      source: 'PENTAGRAMA_LIVE_DYNAMIC',
      certifiedAt,
      productCode: text(live.productCode),
      groupCode: text(live.groupCode),
      associationGroup: text(live.associationGroup),
      primaryGroup: text(live.primaryGroup),
      calculationType: text(live.calculationType),
      unit: text(live.unit),
      note: RING_NOTE,
      evidence: evidence.map(item => ({ id: item.id, width: item.width, height: item.height, total: item.total }))
    };
    const rowValues = [
      id, 'ring', 'Cortina Ring', ref, type, 'area', rate,
      0, 0, 0, false, RING_CONFIGURATION, true, 'VIGENTE',
      text(sourceCatalog.validThrough), text(sourceCatalog.version), 'COP', true,
      'Pentagrama Live', '', JSON.stringify(rules)
    ];
    const qaCases = evidence.map(item => ({
      id: item.id,
      width: String(item.width),
      height: String(item.height),
      quantity: 1,
      expected: item.total,
      homeeasy: { product: id, width: String(item.width), height: String(item.height), quantity: '1', extras: '0' }
    }));
    return {
      ok: true,
      status: 'CERTIFIED',
      family: 'ring',
      homeeasyId: id,
      reference: ref,
      type,
      rate,
      externalKey: live.externalKey,
      rowValues,
      qaCases,
      evidence,
      rules
    };
  }
}

module.exports = Object.freeze({
  CatalogCertifier,
  RING_SAMPLES,
  RING_CONFIGURATION,
  RING_NOTE,
  ENROLLABLE_PRICE_SAMPLES,
  dynamicProductSpec,
  enrollableType,
  homeeasyIdForEnrollableRoute,
  inferAreaModel,
  isRing,
  isRenueva,
  ringType,
  referenceName,
  homeeasyIdForRing,
  sourceRowValues
});
