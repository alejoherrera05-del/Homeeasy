'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CatalogCertifier,
  isRing,
  isRenueva,
  ringType,
  referenceName,
  sourceRowValues
} = require('./catalog-certifier');
const structuralProfiles = require('./enrollables-structural-profiles.json');
const { localFabrication, portalFabricationProfile } = require('./local-model');

function live(overrides = {}) {
  return {
    name: 'Cortina Ring al 2.0 Velo Angolo Grey',
    productCode: 'CORONSERIVEANGGRE',
    groupCode: '1346',
    associationGroup: 'RIECORIN',
    primaryGroup: 'CORTINARING',
    calculationType: 'NormalProduct',
    unit: 'MT2',
    discount: 0,
    path: ['CORTINA RING', 'VELO'],
    externalKey: 'CORONSERIVEANGGRE|1346|RIECORIN',
    ...overrides
  };
}

test('Ring recognizer is strict about supplier technical identity', () => {
  assert.equal(isRing(live()), true);
  assert.equal(isRing(live({ groupCode: '999' })), false);
  assert.equal(isRenueva(live({ name: 'Cortina Ring Renueva Velo X' })), true);
  assert.equal(ringType(live()), 'Velo');
  assert.equal(ringType(live({ path: ['CORTINA RING', 'TRASLÚCIDO'] })), 'Traslúcido');
  assert.equal(referenceName(live()), 'Angolo Grey');
});

test('new Ring is certified only when three real samples reproduce the same area rate', async () => {
  const calls = [];
  const certifier = new CatalogCertifier({
    pricing: {
      supplierCost: async params => {
        calls.push(params);
        const total = Number(params.Width) * Number(params.Height) * 110955.6;
        return { total, basePrice: total / 1.19, distributorDiscount: 0, productDiscount: 0, vatRate: 0.19 };
      }
    }
  });
  const result = await certifier.certifyRing(live(), { version: '2026-10-14', validThrough: '2026-10-31' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'CERTIFIED');
  assert.equal(result.rate, 110955.6);
  assert.equal(result.rowValues.length, 21);
  assert.equal(result.rowValues[0], 'ring-coronseriveanggre');
  assert.equal(result.rowValues[3], 'Angolo Grey');
  assert.equal(result.rowValues[4], 'Velo');
  assert.equal(result.qaCases.length, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(item => item.ProductCode === 'CORONSERIVEANGGRE'));
});

test('zero price and non-linear Ring stay blocked', async () => {
  const zero = new CatalogCertifier({ pricing: { supplierCost: async () => ({ total: 0 }) } });
  const zeroResult = await zero.certifyRing(live(), {});
  assert.equal(zeroResult.ok, false);
  assert.equal(zeroResult.status, 'REVIEW_REQUIRED');

  let n = 0;
  const nonlinear = new CatalogCertifier({ pricing: { supplierCost: async params => {
    n += 1;
    const total = Number(params.Width) * Number(params.Height) * 100000 + (n === 3 ? 1000 : 0);
    return { total };
  } } });
  const result = await nonlinear.certifyRing(live(), {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 'REVIEW_REQUIRED');
});

test('Renueva is never certified for HomeEasy', async () => {
  const certifier = new CatalogCertifier({ pricing: { supplierCost: async () => { throw new Error('must not price'); } } });
  const result = await certifier.certifyRing(live({ name: 'Cortina Ring Renueva Velo Test', path: ['CORTINA RING', 'RENUEVA', 'VELO'] }), {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 'EXCLUDED');
});

test('embedded products can be converted into Sheet override rows without losing identity', () => {
  const row = sourceRowValues({
    id: 'ring-old',
    family: 'ring',
    familyName: 'Cortina Ring',
    reference: 'Old',
    type: 'Velo',
    method: 'area',
    rate: 100000,
    active: true,
    status: 'VIGENTE',
    configuration: 'cfg',
    external: {
      productCode: 'P',
      groupCode: '1346',
      associationGroup: 'RIECORIN',
      calculationType: 'NormalProduct',
      unit: 'MT2'
    }
  }, { version: 'v1', validThrough: '2026-10-31' }, { active: false, status: 'DESCONTINUADO' });
  assert.equal(row.length, 21);
  assert.equal(row[12], false);
  assert.equal(row[13], 'DESCONTINUADO');
  const rules = JSON.parse(row[20]);
  assert.equal(rules.productCode, 'P');
  assert.equal(rules.associationGroup, 'RIECORIN');
});

test('a genuinely new Enrollable route is priced, structurally certified and converted into one Sheet reference', async () => {
  const profile = portalFabricationProfile(structuralProfiles.profiles['enrollable-blackout-angora']);
  const rate = 105707.7;
  const calls = [];
  const certifier = new CatalogCertifier({
    pricing: { supplierCost: async () => ({ total: 1 }) },
    gateway: {
      dispatch: async (type, payload) => {
        calls.push(payload);
        if (type === 'catalog') return { Price: 0 };
        if (type === 'getPrice') {
          const sample = { width: Number(payload.params.Width), height: Number(payload.params.Height) };
          return { total: Math.round(rate * Math.max(sample.width * Math.max(sample.height, 1), 1) * 100) / 100 };
        }
        assert.equal(type, 'resolveLivePrice');
        const sample = { width: Number(payload.width), height: Number(payload.height) };
        const fabrication = localFabrication({ rules: { minWidthMm: 250, minHeightMm: 400, fabricationProfile: profile } }, sample, {});
        if (fabrication.outcome === 'NOT_MANUFACTURABLE') {
          return { ok: false, outcome: 'NOT_MANUFACTURABLE', code: 'PENTAGRAMA_NOT_MANUFACTURABLE' };
        }
        return {
          ok: true,
          outcome: fabrication.outcome,
          configuration: { orientationCode: fabrication.orientationCode, mechanism: fabrication.mechanism },
          fabrication: {
            requiresAuthorization: fabrication.requiresAuthorization,
            warranty: fabrication.warranty
          },
          pricing: { total: Math.round(rate * Math.max(sample.width * Math.max(sample.height, 1), 1) * 100) / 100 }
        };
      }
    }
  });
  const route = {
    routeKey: '4|79|8|2333',
    categories: { Cat1: '4', Cat2: '79', Cat3: '8', Cat4: '2333' },
    groupName: 'BLACK OUT',
    referenceName: 'MÁRMOL 3',
    products: [
      { name: 'Enrollable Standard Black Out Marmol Alabaster 3 sin Cabezal', productCode: 'ENRSTDBOMARALA3M', groupCode: '599', associationGroup: 'ENRSTD', primaryGroup: 'ENROLLABLE', calculationType: 'NormalProduct', unit: 'UND' },
      { name: 'Enrollable Standard Black Out Marmol Blanco 3 sin Cabezal', productCode: 'ENRSTDBOMARBLA3M', groupCode: '599', associationGroup: 'ENRSTD', primaryGroup: 'ENROLLABLE', calculationType: 'NormalProduct', unit: 'UND' }
    ]
  };
  const result = await certifier.certifyEnrollableRoute(route, { version: 'v1', validThrough: '2026-12-31' });
  assert.equal(result.ok, true);
  assert.equal(result.homeeasyId, 'enrollable-blackout-marmol3');
  assert.equal(result.reference, 'Mármol 3');
  assert.equal(result.rate, rate);
  assert.equal(result.minHeight, 1);
  assert.equal(result.minArea, 1);
  assert.equal(result.rowValues.length, 21);
  assert.equal(result.qaCases.length, 5);
  const rules = JSON.parse(result.rowValues[20]);
  assert.equal(rules.routeKey, '4|79|8|2333');
  assert.equal(rules.variants.length, 2);
  assert.equal(rules.fabricationProfile.rollWidthMm, 3000);
  assert.ok(calls.length < 80);
});

test('a new Enrollable inherits only its exact certified family when Pentagrama omits manufacturing defaults', async () => {
  const rate = 105707.7;
  let structureCalls = 0;
  const certifier = new CatalogCertifier({
    pricing: { supplierCost: async () => ({ total: 1 }) },
    gateway: {
      dispatch: async (type, payload) => {
        if (type === 'catalog') return { Price: 0 };
        if (type === 'getPrice') {
          const width = Number(payload.params.Width);
          const height = Number(payload.params.Height);
          return { total: Math.round(rate * Math.max(width * Math.max(height, 1), 1) * 100) / 100 };
        }
        structureCalls += 1;
        return {
          ok: false,
          outcome: 'CONFIGURATION_UNRESOLVED',
          code: 'PENTAGRAMA_CONFIGURATION_UNRESOLVED',
          reason: 'Pentagrama did not resolve Dirección de la tela and Mecanismo'
        };
      }
    }
  });
  const result = await certifier.certifyEnrollableRoute({
    routeKey: '4|79|8|2333',
    categories: { Cat1: '4', Cat2: '79', Cat3: '8', Cat4: '2333' },
    groupName: 'BLACK OUT',
    referenceName: 'MÁRMOL 3',
    products: [
      { name: 'Enrollable Standard Black Out Marmol Blanco 3 sin Cabezal', productCode: 'ENRSTDBOMARBLA3M', groupCode: '599', associationGroup: 'ENRSTD', calculationType: 'NormalProduct', unit: 'UND' }
    ]
  }, { version: 'v1', validThrough: '2026-12-31' });
  assert.equal(result.ok, true);
  assert.equal(structureCalls, 1);
  assert.equal(result.rules.fabricationProfile.rollWidthMm, 3000);
  assert.equal(result.rules.evidence.fabricationSource, 'INHERITED_CERTIFIED_FAMILY');
  assert.equal(result.rules.evidence.inheritedFrom, 'enrollable-blackout-marmol');

  const silver = await certifier.certifyEnrollableRoute({
    routeKey: '4|79|8|2334', categories: { Cat1: '4', Cat2: '79', Cat3: '8', Cat4: '2334' },
    groupName: 'BLACK OUT', referenceName: 'MATTE SILVER',
    products: [{ name: 'Enrollable Standard Black Out Matte Silver sin Cabezal', productCode: 'ENRSTDBOMASIL', groupCode: '306', associationGroup: 'ENRSTD', calculationType: 'NormalProduct', unit: 'UND' }]
  }, { version: 'v1', validThrough: '2026-12-31' });
  assert.equal(silver.ok, true);
  assert.equal(silver.rules.fabricationProfile.rollWidthMm, 1830);
  assert.equal(silver.rules.evidence.inheritedFrom, 'enrollable-blackout-matte');

  const silver3 = await certifier.certifyEnrollableRoute({
    routeKey: '4|79|8|2335', categories: { Cat1: '4', Cat2: '79', Cat3: '8', Cat4: '2335' },
    groupName: 'BLACK OUT', referenceName: 'MATTE SILVER 3',
    products: [{ name: 'Enrollable Standard Black Out Matte Silver 3 sin Cabezal', productCode: 'ENRSTDBOMASIL3M', groupCode: '599', associationGroup: 'ENRSTD', calculationType: 'NormalProduct', unit: 'UND' }]
  }, { version: 'v1', validThrough: '2026-12-31' });
  assert.equal(silver3.ok, true);
  assert.equal(silver3.rules.fabricationProfile.rollWidthMm, 3000);
  assert.equal(silver3.rules.evidence.inheritedFrom, 'enrollable-blackout-matte3');
  assert.equal(structureCalls, 3);
});

test('an unresolved new Enrollable without an exact certified family remains blocked', async () => {
  const certifier = new CatalogCertifier({
    pricing: { supplierCost: async () => ({ total: 1 }) },
    gateway: {
      dispatch: async (type, payload) => {
        if (type === 'catalog') return { Price: 0 };
        if (type === 'getPrice') {
          const width = Number(payload.params.Width);
          const height = Number(payload.params.Height);
          return { total: Math.round(90000 * Math.max(width * Math.max(height, 1), 1) * 100) / 100 };
        }
        return { ok: false, code: 'PENTAGRAMA_CONFIGURATION_UNRESOLVED', outcome: 'CONFIGURATION_UNRESOLVED' };
      }
    }
  });
  await assert.rejects(() => certifier.certifyEnrollableRoute({
    routeKey: '4|79|8|9999', categories: { Cat1: '4', Cat2: '79', Cat3: '8', Cat4: '9999' },
    groupName: 'BLACK OUT', referenceName: 'REFERENCIA TOTALMENTE NUEVA',
    products: [{ name: 'Nueva', productCode: 'ENRSTDBONUEVA', groupCode: '306', associationGroup: 'ENRSTD', calculationType: 'NormalProduct', unit: 'UND' }]
  }), error => error.code === 'PENTAGRAMA_CONFIGURATION_UNRESOLVED');
});
