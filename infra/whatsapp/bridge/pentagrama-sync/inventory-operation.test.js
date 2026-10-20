'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PentagramaPhase2, publicInventorySummary } = require('./phase2');
const { Phase2Store } = require('./phase2-store');

function tempStore(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return new Phase2Store({ dataDir: directory });
}

function waitForTerminal(store, id, limit = 100) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const timer = setInterval(() => {
      const operation = store.operationById(id);
      if (operation && ['completed', 'failed'].includes(operation.state)) {
        clearInterval(timer);
        resolve(operation);
        return;
      }
      count += 1;
      if (count >= limit) {
        clearInterval(timer);
        reject(new Error('operation did not finish in test window'));
      }
    }, 5);
  });
}

test('read-only inventory is orchestrated as one catalogInventory job with a compact result', async () => {
  const store = tempStore('pentagrama-inventory-operation-');
  const updates = [];
  const originalUpdate = store.updateOperation.bind(store);
  store.updateOperation = (id, patch) => {
    updates.push(JSON.parse(JSON.stringify(patch)));
    return originalUpdate(id, patch);
  };

  const calls = [];
  const gateway = {
    dispatch: async (type, payload, options) => {
      calls.push({ type, payload: JSON.parse(JSON.stringify(payload || {})) });
      assert.equal(type, 'catalogInventory');
      assert.deepEqual(payload, {});
      assert.equal(options.lockKey, 'catalog-inventory:full');
      return {
        checkedAt: '2026-10-20T00:00:00.000Z',
        counts: { roots: 2, discoveredRoots: 2, excludedRoots: 0, leaves: 3, products: 3 },
        requests: 6,
        products: [{
          ProductName: 'Ring A',
          name: 'Ring A',
          ProductCode: 'RA',
          productCode: 'RA',
          GroupCode: '1346',
          groupCode: '1346',
          GrupAsoc: 'RIECORIN',
          associationGroup: 'RIECORIN',
          externalKey: 'RA|1346|RIECORIN',
          path: ['CORTINA RING', 'VELO']
        }, {
          ProductName: 'Renueva Ring',
          name: 'Renueva Ring',
          ProductCode: 'RR',
          productCode: 'RR',
          GroupCode: '1346',
          groupCode: '1346',
          GrupAsoc: 'RIECORIN',
          associationGroup: 'RIECORIN',
          externalKey: 'RR|1346|RIECORIN',
          path: ['CORTINA RING', 'RENUEVA']
        }, {
          ProductName: 'Screen',
          name: 'Screen',
          ProductCode: 'E1',
          productCode: 'E1',
          GroupCode: '599',
          groupCode: '599',
          GrupAsoc: 'ENR',
          associationGroup: 'ENR',
          externalKey: 'E1|599|ENR',
          path: ['ENROLLABLE', 'SCREEN']
        }]
      };
    }
  };

  const service = new PentagramaPhase2({
    store,
    mappings: [],
    pricing: {},
    homeeasyCost: {},
    gateway,
    inventoryOptions: {
      wait: async () => {},
      retryWindowMs: 1000
    }
  });

  const operation = service.startInventory({ email: 'test@example.com' });
  const completed = await waitForTerminal(store, operation.id);

  assert.equal(completed.state, 'completed');
  assert.equal(completed.stage, 'COMPLETED');
  assert.equal(completed.result.counts.roots, 2);
  assert.equal(completed.result.counts.leaves, 3);
  assert.equal(completed.result.counts.products, 3);
  assert.equal(completed.result.counts.requests, 6);

  assert.deepEqual(completed.result.critical.ring, {
    family: 'CORTINA RING',
    products: 2,
    renueva: 1,
    eligibleProducts: 1
  });

  assert.deepEqual(completed.result.critical.enrollable, {
    family: 'ENROLLABLE',
    products: 1,
    renueva: 0,
    eligibleProducts: 1
  });

  assert.equal('products' in completed.result, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'catalogInventory');

  assert.deepEqual(completed.progress, {
    status: 'COMPLETED',
    rootsTotal: 2,
    rootsCompleted: 2,
    currentFamily: null,
    requests: 6,
    leaves: 3,
    products: 3
  });
});

test('inventory records a temporary Agent outage as a controlled failed operation', async () => {
  const store = tempStore('pentagrama-inventory-retry-');
  const updates = [];
  const originalUpdate = store.updateOperation.bind(store);
  store.updateOperation = (id, patch) => {
    updates.push(JSON.parse(JSON.stringify(patch)));
    return originalUpdate(id, patch);
  };

  const gateway = {
    dispatch: async type => {
      assert.equal(type, 'catalogInventory');
      throw Object.assign(new Error('temporarily offline'), { code: 'AGENT_OFFLINE' });
    }
  };

  const service = new PentagramaPhase2({
    store,
    mappings: [],
    pricing: {},
    homeeasyCost: {},
    gateway,
    inventoryOptions: {
      wait: async () => {},
      retryWindowMs: 1000,
      retryDelayMs: 1
    }
  });

  const operation = service.startInventory({ email: 'test@example.com' });
  const completed = await waitForTerminal(store, operation.id);

  assert.equal(completed.state, 'failed');
  assert.equal(completed.error.code, 'AGENT_OFFLINE');
  assert.ok(updates.some(update => update.state === 'failed'));
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
