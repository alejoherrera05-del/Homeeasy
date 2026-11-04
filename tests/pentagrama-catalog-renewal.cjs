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

console.log('PASS pentagrama catalog renewal normalizes Sheet Date values');
