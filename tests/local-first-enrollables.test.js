'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const localModelSource = fs.readFileSync(path.join(root, 'infra', 'whatsapp', 'bridge', 'pentagrama-sync', 'local-model.js'), 'utf8');
const costs10B = fs.readFileSync(path.join(root, 'apps-script', 'ETAPA_10B_COSTOS_PENTAGRAMA.gs'), 'utf8');
const calculator = fs.readFileSync(path.join(root, 'homeeasy-cost-calculator.js'), 'utf8');
const costs = fs.readFileSync(path.join(root, 'apps-script', 'ETAPA_10B_COSTOS_PENTAGRAMA.gs'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'apps-script', 'ETAPA_10C_PENTAGRAMA_SYNC.gs'), 'utf8');
const inventory = require('../infra/whatsapp/bridge/pentagrama-sync/enrollables-live-products.json');

test('ordinary quotations use the local 10B response and never await Live pricing', () => {
  assert.match(calculator, /const quote=data\.quote;/);
  assert.doesNotMatch(calculator, /const quote=await applyPentagramaLive\(/);
  assert.doesNotMatch(calculator, /PENTAGRAMA_LIVE_URL/);
  assert.match(calculator, /pentagramaUpdatedAt/);
});

test('10B supports local configuration supplements and exposes snapshot metadata', () => {
  assert.match(costs, /selectedSupplementId/);
  assert.match(costs, /PENTAGRAMA_LAST_UPDATED_AT/);
  assert.match(costs, /HOMEEASY_COST_CATALOG_V5_LOCAL_FIRST/);
});

test('10C snapshots products, matrices and config before atomic publication', () => {
  assert.match(sync, /Costos_Pentagrama_Snapshots_V2/);
  assert.match(sync, /HOMEEASY_COST_MATRIX_SHEET/);
  assert.match(sync, /modelCandidate/);
  assert.match(sync, /restaurarSnapshotV2PentagramaSync10C_/);
});

test('10C QA compares certified portal orientationCode instead of collapsing TATSG/TANSG', () => {
  assert.match(sync, /fabrication\.orientationCode/);
  assert.match(sync, /orientaciónEsperada/);
  assert.match(sync, /mecanismoEsperado/);
});

test('special Penta13 and Coverlight mechanisms are persisted and consumed locally', () => {
  assert.match(localModelSource, /fabricationMechanismBands/);
  assert.match(localModelSource, /assertSpecialMechanism/);
  assert.match(costs10B, /aplicarPerfilFabricacionComplementos10B_/);
  assert.match(costs10B, /fabricationMechanismBands/);
});

test('Penta13 and Coverlight mechanism profiles are persisted on the parent Enrollable', () => {
  assert.match(localModelSource, /fabricationMechanismBands: specialMechanismBands\.map/);
  assert.match(localModelSource, /coverlightMechanismBands\[id\]/);
  assert.match(costs10B, /variant\.fabricationMechanismBands/);
  assert.match(costs10B, /productRules\.coverlightMechanismBands\[coverlightId\]/);
});

test('the local-first inventory remains exactly the 279 certified Enrollables', () => {
  assert.equal(Object.keys(inventory.products).length, 279);
});
