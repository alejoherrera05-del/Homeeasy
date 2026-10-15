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
