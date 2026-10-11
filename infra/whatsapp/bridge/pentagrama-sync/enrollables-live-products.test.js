'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('./enrollables-live-products.json');

test('generated live inventory covers every HomeEasy Enrollable without weak matches', () => {
  const products = Object.values(inventory.products);
  assert.equal(products.length, 279);
  assert.deepEqual(inventory.review, []);
  assert.deepEqual(inventory.notFound, []);
  assert.equal(products.every(product => product.status === 'LIVE_SUPPORTED'), true);
  assert.equal(products.every(product => product.productCode && product.groupCode && product.calculationType === 'NormalProduct'), true);
});

test('generated inventory preserves exact portal-only references instead of forcing mappings', () => {
  assert.deepEqual(inventory.excludedPortal.map(product => product.reference).sort(), ['AMORE', 'ECOSCREEN', 'NATURA']);
});

test('all required Enrollable subfamilies are represented', () => {
  const counts = Object.values(inventory.products).reduce((result, product) => {
    result[product.subfamily] = (result[product.subfamily] || 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, { blackout: 46, screen: 85, trasluz: 90, dimout: 6, lona: 1, soltis: 2, serenade: 49 });
});
