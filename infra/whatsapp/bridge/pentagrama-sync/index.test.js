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

test('direct mode does not instantiate a gateway-only catalog inventory reader', () => {
  const sync = createPentagramaSync({ mode: 'direct' });
  assert.equal(sync.mode, 'direct');
  assert.equal(sync.catalogInventory, null);
});
