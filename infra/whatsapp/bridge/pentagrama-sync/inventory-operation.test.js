'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PentagramaPhase2, publicInventorySummary } = require('./phase2');
const { Phase2Store } = require('./phase2-store');

test('read-only inventory operation runs as one Agent job and exposes only compact summary data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-inventory-operation-'));
  const store = new Phase2Store({ dataDir: directory });
  const calls = [];
  const inventory = {
    checkedAt: '2026-10-15T02:00:00Z',
    requests: 44,
    counts: { roots: 59, leaves: 300, products: 4, duplicateAppearances: 2, skippedWithoutCode: 1 },
    products: [
      {
        name: 'Ring A',
        productCode: 'RA',
        groupCode: '1346',
        associationGroup: 'RIECORIN',
        externalKey: 'RA|1346|RIECORIN',
        path: ['CORTINA RING', 'VELO'],
        paths: [['CORTINA RING', 'VELO']]
      },
      {
        name: 'Renueva Ring',
        productCode: 'RR',
        groupCode: '1346',
        associationGroup: 'RIECORIN',
        externalKey: 'RR|1346|RIECORIN',
        path: ['CORTINA RING', 'RENUEVA'],
        paths: [['CORTINA RING', 'RENUEVA']]
      },
      {
        name: 'Screen',
        productCode: 'E1',
        groupCode: '599',
        associationGroup: 'ENR',
        externalKey: 'E1|599|ENR',
        path: ['ENROLLABLE', 'SCREEN'],
        paths: [['ENROLLABLE', 'SCREEN']]
      },
      {
        name: 'Shared',
        productCode: 'S1',
        groupCode: '1',
        associationGroup: 'X',
        externalKey: 'S1|1|X',
        path: ['ENROLLABLE', 'OTRO'],
        paths: [['ENROLLABLE', 'OTRO'], ['ACCESORIO PRODUCTO', 'OTRO']]
      }
    ]
  };

  const service = new PentagramaPhase2({
    store,
    mappings: [],
    pricing: {},
    homeeasyCost: {},
    gateway: {
      dispatch: async (type, payload, options) => {
        calls.push({ type, payload, options });
        assert.equal(type, 'catalogInventory');
        assert.equal(options.lockKey, 'catalog-inventory:full');
        return inventory;
      }
    }
  });

  const operation = service.startInventory({ email: 'test@example.com' });

  for (let i = 0; i < 50 && store.operationById(operation.id).state !== 'completed'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const completed = store.operationById(operation.id);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.stage, 'COMPLETED');
  assert.equal(calls.length, 1);
  assert.equal(completed.result.counts.roots, 59);
  assert.equal(completed.result.counts.requests, 44);
  assert.deepEqual(completed.result.critical.ring, {
    family: 'CORTINA RING',
    products: 2,
    renueva: 1,
    eligibleProducts: 1
  });
  assert.deepEqual(completed.result.critical.enrollable, {
    family: 'ENROLLABLE',
    products: 2,
    renueva: 0,
    eligibleProducts: 2
  });
  assert.equal('products' in completed.result, false);
});

test('public inventory summary deduplicates a product that appears in multiple paths of the same family', () => {
  const summary = publicInventorySummary({
    counts: { roots: 2, leaves: 3, products: 2 },
    products: [
      {
        name: 'A',
        productCode: 'A',
        groupCode: '1',
        associationGroup: 'X',
        externalKey: 'A|1|X',
        path: ['ENROLLABLE', 'SCREEN'],
        paths: [['ENROLLABLE', 'SCREEN'], ['ENROLLABLE', 'BLACKOUT']]
      },
      {
        name: 'B',
        productCode: 'B',
        groupCode: '1',
        associationGroup: 'X',
        externalKey: 'B|1|X',
        path: ['CORTINA RING', 'VELO'],
        paths: [['CORTINA RING', 'VELO']]
      }
    ]
  });

  assert.equal(summary.families.find(item => item.family === 'ENROLLABLE').products, 1);
  assert.equal(summary.families.find(item => item.family === 'CORTINA RING').products, 1);
});
