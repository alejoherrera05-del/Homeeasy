const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'homeeasy-cost-calculator.js'), 'utf8');

test('Enrollable quotes request automatic Pentagrama configuration', () => {
  assert.match(source, /configuration:'auto'/);
  assert.match(source, /await applyPentagramaLive\(data\.quote\)/);
});

test('every supported Enrollable result renders its fabrication configuration', () => {
  assert.match(source, /function fabricationConfigurationLabel\(result\)/);
  assert.match(source, /<strong>Configuración automática<\/strong>/);
  assert.match(source, /fabrication\.configurationLabel\|\|product\.configuration/);
});
