'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('catalog inventory endpoint is read-only and asynchronous', () => {
  const route = "if (req.method === 'POST' && url.pathname === '/api/pentagrama-sync/catalog-inventory')";
  const start = server.indexOf(route);
  assert.notEqual(start, -1);

  const block = server.slice(start, start + 800);
  assert.match(block, /auth\.authorize\(req, 'config\.read'\)/);
  assert.match(block, /pentagramaPhase2\.startInventory\(/);
  assert.match(block, /return json\(res, 202,/);
  assert.doesNotMatch(block, /startApply|applyCatalog|applyLocalModel|rollback|WRITING_SHEET/);
});

test('bridge version identifies the inventory-readonly deployment', () => {
  assert.match(server, /const BRIDGE_VERSION = '0\.18\.3';/);
});

test('internal Pentagrama scan/apply/rollback use scheduler service context', () => {
  assert.match(server, /function pentagramaOperationContext\(req\)/);
  assert.match(server, /auth\.isInternal\(req\)/);
  assert.match(server, /return pentagramaScheduler\.context\(\)/);

  for (const route of [
    '/api/pentagrama-sync/scan',
    '/api/pentagrama-sync/apply',
    '/api/pentagrama-sync/rollback'
  ]) {
    const start = server.indexOf(`url.pathname === '${route}'`);
    assert.notEqual(start, -1);
    const block = server.slice(start, start + 650);
    assert.match(block, /pentagramaOperationContext\(req\)/);
  }
});



test('enrollables audit endpoint is read-only and asynchronous', () => {
  const route = "if (req.method === 'POST' && url.pathname === '/api/pentagrama-sync/enrollables-audit')";
  const start = server.indexOf(route);
  assert.notEqual(start, -1);

  const block = server.slice(start, start + 800);
  assert.match(block, /auth\.authorize\(req, 'config\.read'\)/);
  assert.match(block, /pentagramaPhase2\.startEnrollablesAudit\(/);
  assert.match(block, /return json\(res, 202,/);
  assert.doesNotMatch(block, /startApply|applyCatalog|applyLocalModel|rollback|WRITING_SHEET/);
});


test('quick price scan endpoint is separate from deep maintenance scan', () => {
  const quickRoute = "if (req.method === 'POST' && url.pathname === '/api/pentagrama-sync/quick-scan')";
  const deepRoute = "if (req.method === 'POST' && url.pathname === '/api/pentagrama-sync/scan')";
  const quick = server.indexOf(quickRoute);
  const deep = server.indexOf(deepRoute);
  assert.notEqual(quick, -1);
  assert.notEqual(deep, -1);
  assert.ok(quick < deep);
  assert.match(server.slice(quick, quick + 500), /startQuickScan/);
  assert.match(server.slice(deep, deep + 500), /startScan/);
});


test('targeted certification maintenance endpoint is separate from deep scan', () => {
  const route = "if (req.method === 'POST' && url.pathname === '/api/pentagrama-sync/maintenance-rules')";
  const start = server.indexOf(route);
  assert.notEqual(start, -1);
  assert.match(server.slice(start, start + 500), /startRuleMaintenance/);
});
