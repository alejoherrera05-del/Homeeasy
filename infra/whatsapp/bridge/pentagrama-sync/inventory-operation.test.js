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

test('read-only inventory is orchestrated through short catalog jobs with persistent progress', async () => {
  const store = tempStore('pentagrama-inventory-operation-');
  const updates = [];
  const originalUpdate = store.updateOperation.bind(store);
  store.updateOperation = (id, patch) => {
    updates.push(JSON.parse(JSON.stringify(patch)));
    return originalUpdate(id, patch);
  };

  const calls = [];
  const gateway = {
    dispatch: async (type, payload) => {
      calls.push({ type, payload: JSON.parse(JSON.stringify(payload || {})) });
      assert.equal(type, 'catalog');
      assert.ok(['categories', 'products'].includes(payload.operation));

      const params = payload.params || {};

      if (payload.operation === 'categories' && params.level === 1) {
        return [
          { Code: '83', Name: 'CORTINA RING', Levels: 2 },
          { Code: '4', Name: 'ENROLLABLE', Levels: 2 }
        ];
      }

      if (payload.operation === 'categories' && params.Category1 === '83') {
        return [
          { Code: '1', Name: 'VELO' },
          { Code: '2', Name: 'RENUEVA' }
        ];
      }

      if (payload.operation === 'categories' && params.Category1 === '4') {
        return [{ Code: '1', Name: 'SCREEN' }];
      }

      if (payload.operation === 'products' && params.Category1 === '83' && params.Category2 === '1') {
        return [{
          ProductName: 'Ring A',
          ProductCode: 'RA',
          GroupCode: '1346',
          GrupAsoc: 'RIECORIN'
        }];
      }

      if (payload.operation === 'products' && params.Category1 === '83' && params.Category2 === '2') {
        return [{
          ProductName: 'Renueva Ring',
          ProductCode: 'RR',
          GroupCode: '1346',
          GrupAsoc: 'RIECORIN'
        }];
      }

      if (payload.operation === 'products' && params.Category1 === '4' && params.Category2 === '1') {
        return [{
          ProductName: 'Screen',
          ProductCode: 'E1',
          GroupCode: '599',
          GrupAsoc: 'ENR'
        }];
      }

      throw new Error('unexpected catalog request in test');
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
  assert.ok(calls.length > 1);
  assert.ok(calls.every(call => call.type === 'catalog'));
  assert.equal(calls.some(call => call.type === 'catalogInventory'), false);

  const familyProgress = updates
    .map(update => update.progress)
    .filter(Boolean)
    .filter(progress => progress.currentFamily);

  assert.ok(familyProgress.some(progress => progress.currentFamily === 'CORTINA RING'));
  assert.ok(familyProgress.some(progress => progress.currentFamily === 'ENROLLABLE'));

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

test('inventory waits and resumes after a temporary Agent outage instead of failing the whole run', async () => {
  const store = tempStore('pentagrama-inventory-retry-');
  const updates = [];
  const originalUpdate = store.updateOperation.bind(store);
  store.updateOperation = (id, patch) => {
    updates.push(JSON.parse(JSON.stringify(patch)));
    return originalUpdate(id, patch);
  };

  let attempts = 0;
  const gateway = {
    dispatch: async (type, payload) => {
      assert.equal(type, 'catalog');
      attempts += 1;

      if (attempts === 1) {
        throw Object.assign(new Error('temporarily offline'), { code: 'AGENT_OFFLINE' });
      }

      if (payload.operation === 'categories' && payload.params && payload.params.level === 1) {
        return [];
      }

      throw new Error('unexpected retry test request');
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

  assert.equal(completed.state, 'completed');
  assert.equal(attempts, 2);
  assert.ok(
    updates.some(update =>
      update.stage === 'WAITING_AGENT' &&
      update.progress &&
      update.progress.status === 'WAITING_AGENT' &&
      update.progress.waitingCode === 'AGENT_OFFLINE'
    )
  );
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
