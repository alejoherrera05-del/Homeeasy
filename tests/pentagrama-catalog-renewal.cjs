'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source10b = fs.readFileSync(path.join(root, 'apps-script', 'ETAPA_10B_COSTOS_PENTAGRAMA.gs'), 'utf8');
const source10c = fs.readFileSync(path.join(root, 'apps-script', 'ETAPA_10C_PENTAGRAMA_SYNC.gs'), 'utf8');
const context = {
  console,
  Utilities: {
    formatDate(value) {
      return [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0')
      ].join('-');
    }
  }
};

vm.createContext(context);
vm.runInContext(source10b, context, { filename: 'ETAPA_10B_COSTOS_PENTAGRAMA.gs' });
vm.runInContext(source10c, context, { filename: 'ETAPA_10C_PENTAGRAMA_SYNC.gs' });

const normalizedDate = vm.runInContext("normalizarFechaCostos10B_(new Date(2026, 9, 31))", context);
assert.equal(normalizedDate, '2026-10-31');
assert.equal(vm.runInContext("normalizarFechaCostos10B_('2026-10-31')", context), '2026-10-31');
assert.equal(normalizedDate < '2026-12-31', true);

assert.match(
  source10c,
  /normalizarFechaCostos10B_\(before\[14\]\) >= proposedValidity/,
  'La renovación debe comparar fechas normalizadas, no String(Date) contra ISO.'
);

assert.match(
  source10c,
  /normalizarFechaCostos10B_\(configBefore\[1\]\) !== expectedValidity/,
  'La precondición de VIGENTE_HASTA también debe normalizar fechas nativas de Sheets.'
);

// El catálogo vencido debe seguir mostrando Enrollables certificados.
// Las tarifas vencidas se señalan en cotización, no se eliminan del selector.
const expiredCatalog = {
  version: '2026-10-02.1', validThrough: '2026-10-31', currency: 'COP',
  pricesIncludeVat: true, matrixCount: 0,
  products: [
    { id: 'enrollable-blackout-qa', family: 'enrollable', familyName: 'Enrollables',
      name: 'Blackout QA', type: 'Blackout', method: 'area', rateCents: 12000000,
      active: true, status: 'VIGENTE', pricesIncludeVat: true, currency: 'COP',
      validThrough: '2026-10-31', rules: {} },
    { id: 'enrollable-inactive-qa', family: 'enrollable', familyName: 'Enrollables',
      name: 'Screen QA', type: 'Screen', method: 'area', rateCents: 12000000,
      active: false, status: 'VIGENTE', pricesIncludeVat: true, currency: 'COP',
      validThrough: '2026-10-31', rules: {} }
  ]
};
vm.runInContext('this.__renewalDate = fechaBogota10B_; this.__renewalLoader = cargarCatalogoCostos10B_;', context);
context.fechaBogota10B_ = () => '2026-11-06';
context.cargarCatalogoCostos10B_ = () => expiredCatalog;
const options = vm.runInContext('obtenerOpcionesCostos10B_({})', context);
assert.equal(options.products.length, 1, 'Los productos inactivos deben permanecer ocultos');
assert.equal(options.products[0].family, 'enrollable', 'El enrollable certificado no debe desaparecer por vencimiento');

console.log('PASS pentagrama catalog renewal normalizes Sheet Date values');
