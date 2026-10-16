'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCatalogBindings } = require('./catalog-bindings');

test('HomeEasy source metadata provides the authoritative product binding', () => {
  const result = buildCatalogBindings([
    {
      id: 'ring-1',
      familyName: 'Cortina Ring',
      reference: 'Angolo Grey',
      active: true,
      external: {
        productCode: 'RING001',
        groupCode: '1346',
        associationGroup: 'RIECORIN',
        calculationType: 'NormalProduct',
        source: 'PENTAGRAMA_LIVE'
      }
    }
  ], {
    mappings: [{
      homeeasyId: 'old-id',
      family: 'Old',
      reference: 'Old',
      productCode: 'OTHER',
      groupCode: '1',
      calculationType: 'NormalProduct',
      special: {}
    }],
    enrollables: { products: {} }
  });
  assert.equal(result.conflicts.length, 0);
  const binding = result.bindings.find(item => item.productCode === 'RING001');
  assert.equal(binding.homeeasyId, 'ring-1');
  assert.equal(binding.externalKey, 'RING001|1346|RIECORIN');
});

test('known Enrollables can bootstrap bindings before the sheet stores technical metadata', () => {
  const result = buildCatalogBindings([], {
    mappings: [],
    enrollables: {
      products: {
        x: {
          homeeasyId: 'enrollable-x',
          family: 'Enrollable',
          reference: 'Screen X',
          productCode: 'ENR001',
          groupCode: '599',
          associationGroup: 'ENRSTD',
          primaryGroup: 'ENROLLABLE',
          calculationType: 'NormalProduct',
          status: 'LIVE_SUPPORTED'
        }
      }
    }
  });
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].homeeasyId, 'enrollable-x');
});

test('ambiguous external keys are blocked instead of silently choosing a HomeEasy product', () => {
  const result = buildCatalogBindings([
    { id: 'a', reference: 'A', external: { productCode: 'P', groupCode: '1', associationGroup: 'X' } },
    { id: 'b', reference: 'B', external: { productCode: 'P', groupCode: '1', associationGroup: 'X' } }
  ], { mappings: [], enrollables: { products: {} } });
  assert.equal(result.bindings.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].homeeasyIds, ['a', 'b']);
});
