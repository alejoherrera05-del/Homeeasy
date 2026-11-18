const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'homeeasy-cost-calculator.js'), 'utf8');
const start = source.indexOf('function calculatedCovers');
const end = source.indexOf('function specialAlternativeLabel', start);
assert.ok(start >= 0 && end > start, 'No se encontraron los helpers de Coverlight');

const item = { id: 'qa', product: 'blackout-qa', width: '2', height: '2', coverlight: '' };
const product = {
  id: item.product,
  coverlight: [
    { id: 'coverlight-standard', name: 'Coverlight Standard' },
    { id: 'coverlight-plus', name: 'Coverlight Plus' }
  ]
};
const context = {
  lastEngineQuote: null,
  state: { items: [item] },
  chosen: () => product,
  cop: value => `COP $${Number(value)}`,
  escape: value => String(value)
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

let html = context.coverlightControls(item);
assert.match(html, /data-action="coverlight-toggle"/, 'La casilla debe aparecer antes de calcular');

item.coverlight = 'coverlight-standard';
html = context.coverlightControls(item);
assert.match(html, /precio según alto/, 'Las versiones deben permanecer visibles mientras llega el precio');

context.lastEngineQuote = { items: [{
  ok: true,
  product: { id: item.product },
  widthMm: 2000,
  heightMm: 2000,
  coverlightOptions: [{ id: 'coverlight-standard', name: 'Coverlight Standard', costCents: 49480 }]
}] };
html = context.coverlightControls(item);
assert.match(html, /COP \$49480/, 'El precio calculado debe reemplazar el estado pendiente');
assert.doesNotMatch(html, /precio según alto/);

console.log('Coverlight permanece visible antes, durante y después del cálculo.');
