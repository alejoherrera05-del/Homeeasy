'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPentagramaSync } = require('./index');

test('agent mode constructs without crashing and wires inventory to dispatcher', () => {
  const dispatcher = {
    dispatch: async () => []
  };

  const sync = createPentagramaSync({
    mode: 'agent',
    dispatcher
  });

  assert.equal(sync.mode, 'agent');
  assert.ok(sync.catalogInventory);
  assert.equal(sync.catalogInventory.gateway, dispatcher);
});

test('direct mode wires catalog inventory to the authenticated local catalog client', async () => {
  const calls = [];
  const catalog = {
    categories: async params => { calls.push(['categories', params]); return []; },
    products: async params => { calls.push(['products', params]); return []; }
  };
  const sync = createPentagramaSync({ mode: 'direct', catalog });
  assert.equal(sync.mode, 'direct');
  assert.ok(sync.catalogInventory);
  const inventory = await sync.catalogInventory.scan();
  assert.equal(inventory.counts.roots, 0);
  assert.deepEqual(calls, [['categories', { level: 1 }]]);
});
