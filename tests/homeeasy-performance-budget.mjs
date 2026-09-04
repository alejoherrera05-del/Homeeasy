import fs from 'node:fs';

const ACTIVE_PAGES = new Set([
  'Hommychat.html', 'abono.html', 'activar-cuenta.html', 'ar-homeeasy-v3.html',
  'caja.html', 'calendario.html', 'clientes.html', 'configuracion.html',
  'cotizacion.html', 'documentos.html', 'index.html', 'login.html', 'pedido.html',
  'perfil.html', 'reportes.html', 'seguimiento.html', 'ventas.html'
]);

const report = JSON.parse(fs.readFileSync('qa/homeeasy-performance-baseline.json', 'utf8'));
const rows = report.rows.filter(row => ACTIVE_PAGES.has(row.file));

function fail(message) { throw new Error(message); }
function row(name) {
  const found = rows.find(item => item.file === name);
  if (!found) fail(`Missing production page from performance audit: ${name}`);
  return found;
}

for (const page of rows) {
  if (page.bytes > 260_000) fail(`${page.file}: HTML grew beyond 260 KB (${page.bytes} B)`);
  if (page.inlineScriptBytes > 120_000) fail(`${page.file}: inline JS grew beyond 120 KB (${page.inlineScriptBytes} B)`);
  if (page.blockingRemoteScripts > 2) fail(`${page.file}: more than two blocking remote scripts (${page.blockingRemoteScripts})`);
}

for (const name of ['index.html', 'cotizacion.html', 'pedido.html', 'reportes.html']) {
  if (row(name).blockingRemoteScripts !== 0) fail(`${name}: must keep zero blocking remote scripts`);
}

for (const name of ['cotizacion.html', 'pedido.html', 'abono.html']) {
  if (row(name).storageParses > 1) fail(`${name}: hot-path localStorage parsing regressed`);
}

if (row('index.html').eagerImageBytes > 5_300_000) fail('index.html: eager unique image payload exceeded guarded baseline');
if (row('configuracion.html').bytes > 240_000) fail('configuracion.html: page parse budget regressed');
if (row('clientes.html').inlineScriptBytes > 75_000) fail('clientes.html: inline logic budget regressed');
if (row('calendario.html').innerHtmlAppend > 8) fail('calendario.html: DOM append hot paths regressed');

console.log(`HomeEasy performance budgets: PASS (${rows.length} production pages guarded)`);
