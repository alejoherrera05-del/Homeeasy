'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const baseline = require('./enrollables-live-products.json');
const { PentagramaEnrollablesAudit, baselineSummary } = require('./enrollables-audit');

function entries() {
  return Object.values(baseline.products || {});
}

function category3Rows() {
  const map = new Map();
  for (const item of entries()) {
    const code = String(item.categories && item.categories.Cat3 || '');
    if (!map.has(code)) map.set(code, String(item.subfamily || code).toUpperCase());
  }
  return [...map.entries()].map(([Code, Name]) => ({ Code, Name }));
}

function category4Rows(cat3) {
  const map = new Map();
  for (const item of entries()) {
    if (String(item.categories && item.categories.Cat3 || '') !== String(cat3)) continue;
    const code = String(item.categories && item.categories.Cat4 || '');
    if (!map.has(code)) map.set(code, String(item.reference || code));
  }
  return [...map.entries()].map(([Code, Name]) => ({ Code, Name }));
}

function productRows(cat3, cat4) {
  return entries()
    .filter(item =>
      String(item.categories && item.categories.Cat3 || '') === String(cat3) &&
      String(item.categories && item.categories.Cat4 || '') === String(cat4)
    )
    .map(item => ({
      ProductName: item.friendlyName,
      ProductCode: item.productCode,
      GroupCode: item.groupCode,
      GrupAsoc: item.associationGroup,
      CalculationType: item.calculationType
    }));
}

function exactBaselineGateway(extraProduct) {
  return {
    dispatch: async (type, payload) => {
      assert.equal(type, 'catalog');
      const params = payload.params || {};

      if (payload.operation === 'categories' && params.level === 3) {
        assert.equal(String(params.Category1), '4');
        assert.equal(String(params.Category2), '79');
        return category3Rows();
      }

      if (payload.operation === 'categories' && params.level === 4) {
        return category4Rows(params.Category3);
      }

      if (payload.operation === 'products') {
        const rows = productRows(params.Category3, params.Category4);
        if (
          extraProduct &&
          String(params.Category3) === String(extraProduct.Cat3) &&
          String(params.Category4) === String(extraProduct.Cat4)
        ) {
          rows.push(extraProduct.row);
        }
        return rows;
      }

      throw new Error('unexpected audit request');
    }
  };
}

test('baseline is 279 HomeEasy entries but 278 stable Pentagrama identities', () => {
  const summary = baselineSummary();
  assert.equal(summary.entries.length, 279);
  assert.equal(summary.byKey.size, 278);
  assert.equal(summary.logicalDuplicates.length, 1);
  assert.deepEqual(summary.logicalDuplicates[0].homeeasyIds.sort(), [
    'enrollable-trasluz-calais-blanco-crema',
    'enrollable-trasluz-calais-otros'
  ].sort());
});

test('live Standard Enrollables exact baseline produces zero deltas', async () => {
  const audit = new PentagramaEnrollablesAudit({
    gateway: exactBaselineGateway(),
    wait: async () => {}
  });

  const result = await audit.run();

  assert.deepEqual(result.scope, {
    family: 'ENROLLABLE',
    system: 'STANDARD/PLATINA SIN CABEZAL',
    Cat1: '4',
    Cat2: '79'
  });
  assert.equal(result.baseline.entries, 279);
  assert.equal(result.baseline.uniqueIdentities, 278);
  assert.equal(result.live.uniqueIdentities, 278);
  assert.equal(result.comparison.present, 278);
  assert.equal(result.comparison.added, 0);
  assert.equal(result.comparison.missing, 0);
  assert.equal(result.comparison.structureChanged, 0);
  assert.equal(result.comparison.exactIdentityMatch, true);
});

test('new live identity is reported without changing the baseline', async () => {
  const first = entries()[0];
  const audit = new PentagramaEnrollablesAudit({
    gateway: exactBaselineGateway({
      Cat3: first.categories.Cat3,
      Cat4: first.categories.Cat4,
      row: {
        ProductName: 'Nueva referencia auditada',
        ProductCode: 'ENRTESTNEW',
        GroupCode: '999',
        GrupAsoc: 'ENRSTD',
        CalculationType: 'NormalProduct'
      }
    }),
    wait: async () => {}
  });

  const result = await audit.run();

  assert.equal(result.baseline.entries, 279);
  assert.equal(result.baseline.uniqueIdentities, 278);
  assert.equal(result.live.uniqueIdentities, 279);
  assert.equal(result.comparison.added, 1);
  assert.equal(result.comparison.missing, 0);
  assert.equal(result.comparison.exactIdentityMatch, false);
  assert.equal(result.deltas.added[0].productCode, 'ENRTESTNEW');
});
