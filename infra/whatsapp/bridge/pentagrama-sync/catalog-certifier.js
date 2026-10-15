'use strict';

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
    this.tolerance = Number.isFinite(Number(options.tolerance)) ? Number(options.tolerance) : 0.02;
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
  isRing,
  isRenueva,
  ringType,
  referenceName,
  homeeasyIdForRing,
  sourceRowValues
});
