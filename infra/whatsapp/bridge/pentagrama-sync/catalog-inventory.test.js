'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PentagramaCatalogInventory,
  externalKey,
  compareInventory
} = require('./catalog-inventory');

function fakeGateway(routes) {
  return {
    dispatch: async (type, payload) => {
      assert.equal(type, 'catalog');
      const key = payload.operation + ':' + JSON.stringify(payload.params || {});
      if (!(key in routes)) throw new Error('Unexpected catalog request: ' + key);
      return routes[key];
    }
  };
}

test('external identity is stable and independent from display name', () => {
  assert.equal(externalKey({
    productCode: ' abc ',
    groupCode: ' 10 ',
    associationGroup: ' ring '
  }), 'ABC|10|RING');
});

test('catalog inventory can scope roots before crawling expensive unrelated families', async () => {
  const routes = {
    'categories:{"level":1}': [
      { Code: '102', Name: 'ACCESORIO PRODUCTO', Levels: 4 },
      { Code: '4', Name: 'ENROLLABLE', Levels: 1 }
    ],
    'products:{"Category1":"4"}': [
      { ProductName: 'Screen 5%', ProductCode: 'ENR001', GroupCode: '599', GrupAsoc: 'ENRST' }
    ]
  };
  const inventory = await new PentagramaCatalogInventory({
    gateway: fakeGateway(routes),
    rootFilter: root => root.name === 'ENROLLABLE'
  }).scan();
  assert.equal(inventory.discoveredRoots, 2);
  assert.equal(inventory.excludedRoots, 1);
  assert.equal(inventory.counts.roots, 1);
  assert.equal(inventory.counts.products, 1);
  assert.equal(inventory.requests, 2);
});

test('catalog inventory crawls category leaves and deduplicates the same Pentagrama product', async () => {
  const routes = {
    'categories:{"level":1}': [
      { Code: 'R', Name: 'Cortina Ring', Levels: 2 },
      { Code: 'E', Name: 'Enrollables', Levels: 1 }
    ],
    'categories:{"level":2,"Category1":"R"}': [
      { Code: 'RV', Name: 'Velo' },
      { Code: 'RB', Name: 'Blackout' }
    ],
    'products:{"Category1":"R","Category2":"RV"}': [
      { ProductName: 'Angolo Grey', ProductCode: 'RING001', GroupCode: '1346', GrupAsoc: 'RIECORIN', CalculationType: 'NormalProduct', UnidadMedida: 'MT2' }
    ],
    'products:{"Category1":"R","Category2":"RB"}': [
      { ProductName: 'Angolo Grey', ProductCode: 'RING001', GroupCode: '1346', GrupAsoc: 'RIECORIN', CalculationType: 'NormalProduct', UnidadMedida: 'MT2' },
      { ProductName: 'Blackout Test', ProductCode: 'RING002', GroupCode: '1346', GrupAsoc: 'RIECORIN', CalculationType: 'NormalProduct', UnidadMedida: 'MT2' }
    ],
    'products:{"Category1":"E"}': [
      { ProductName: 'Screen 5%', ProductCode: 'ENR001', GroupCode: '599', GrupAsoc: 'ENRST', CalculationType: 'NormalProduct', UnidadMedida: 'MT2' }
    ]
  };
  const inventory = await new PentagramaCatalogInventory({ gateway: fakeGateway(routes) }).scan();
  assert.equal(inventory.counts.roots, 2);
  assert.equal(inventory.counts.leaves, 3);
  assert.equal(inventory.counts.products, 3);
  assert.equal(inventory.counts.duplicateAppearances, 1);
  const ring = inventory.products.find(item => item.productCode === 'RING001');
  assert.deepEqual(ring.paths, [
    ['Cortina Ring', 'Velo'],
    ['Cortina Ring', 'Blackout']
  ]);
});

test('comparison detects new, discontinued, renamed and structural changes conservatively', () => {
  const bindings = [
    { homeeasyId: 'a', reference: 'Nombre viejo', productCode: 'A', groupCode: '1', associationGroup: 'X', active: true },
    { homeeasyId: 'b', reference: 'B', productCode: 'B', groupCode: '1', associationGroup: 'X', active: true },
    { homeeasyId: 'c', reference: 'C', productCode: 'C', groupCode: '1', associationGroup: 'X', active: true }
  ];
  const live = [
    { name: 'Nombre nuevo', productCode: 'A', groupCode: '1', associationGroup: 'X', externalKey: 'A|1|X' },
    { name: 'B', productCode: 'B', groupCode: '2', associationGroup: 'X', externalKey: 'B|2|X' },
    { name: 'D', productCode: 'D', groupCode: '1', associationGroup: 'X', externalKey: 'D|1|X' }
  ];
  const result = compareInventory(bindings, live);
  assert.equal(result.counts.RENAMED, 1);
  assert.equal(result.counts.STRUCTURE_CHANGED, 1);
  assert.equal(result.counts.NEW, 1);
  assert.equal(result.counts.DISCONTINUED, 1);
  assert.equal(result.results.find(item => item.productCode === 'B').homeeasyId, 'b');
  assert.equal(result.results.find(item => item.productCode === 'C').status, 'DISCONTINUED');
});

test('already inactive missing bindings are not treated as a fresh discontinuation', () => {
  const result = compareInventory([
    { homeeasyId: 'old', reference: 'Old', productCode: 'OLD', groupCode: '1', associationGroup: 'X', active: false }
  ], []);
  assert.equal(result.counts.INACTIVE_MISSING, 1);
  assert.equal(result.counts.DISCONTINUED || 0, 0);
});
