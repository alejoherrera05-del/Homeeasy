'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const server = fs.readFileSync(serverPath, 'utf8');

test('catalog inventory HTTP endpoint is read-only and starts an async inventory operation', () => {
  const route = "if (req.method === 'POST' && url.pathname === '/api/pentagrama-sync/catalog-inventory')";
  const start = server.indexOf(route);
  assert.notEqual(start, -1);

  const block = server.slice(start, start + 700);
  assert.match(block, /auth\.authorize\(req, 'config\.read'\)/);
  assert.match(block, /pentagramaPhase2\.startInventory\(/);
  assert.match(block, /return json\(res, 202,/);
  assert.doesNotMatch(block, /startApply|applyCatalog|applyLocalModel|rollback|WRITING_SHEET/);
});
