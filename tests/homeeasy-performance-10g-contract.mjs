import fs from 'node:fs';

function text(file) { return fs.readFileSync(file, 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Could not isolate ${start}`);
  return source.slice(a, b);
}

const index = text('index.html');
const core = text('homeeasy-core.js');
const auth = text('homeeasy-auth.js');
const cot = text('cotizacion.html');
const pedido = text('pedido.html');
const abono = text('abono.html');
const calendario = text('calendario.html');
const reportes = text('reportes.html');

// Index: security remains HomeEasyCore-owned; only artificial visual waiting is removed.
assert(!index.includes('setTimeout(() => { closeIntro(); }, 5500)'), 'Index still contains artificial 5.5s splash delay');
assert(index.includes("homeeasy:index-auth-ready"), 'Index must react to authoritative auth-ready event');
assert(index.includes('minimoVisualMs = 420'), 'Index must keep a short stable visual minimum');
assert(index.includes('setTimeout(programar, 2400)'), 'Index must retain bounded visual fallback');
assert(core.includes("global.__HOMEEASY_INDEX_AUTH_READY_AT__ = Date.now();"), 'Core must expose auth-ready timing marker');
assert(core.includes("indexAuthStatus = 'authorized'"), 'Core auth authorization gate must remain');
assert(core.includes("indexAuthReadyPromise.then(execute)"), 'Commercial requests must remain gated behind index auth');
assert(index.includes('fetchpriority="high" decoding="async"'), 'Hero image priority hint missing');
assert(index.includes('loading="lazy" decoding="async"'), 'Footer image lazy hint missing');
assert(index.includes('https://cdn.jsdelivr.net') && index.includes('https://cdnjs.cloudflare.com') && index.includes('https://fonts.gstatic.com'), 'Index preconnects missing');

// Presence is telemetry and must not compete with the first business data requests.
const presence = between(auth, 'function startPresenceHeartbeat()', 'async function sendPasswordReset');
assert(presence.includes('requestIdleCallback'), 'First presence touch should be idle-scheduled');
assert(presence.includes('3500'), 'Presence fallback should be delayed');
assert(presence.includes('PRESENCE_INTERVAL_MS'), 'Existing heartbeat cadence must remain');

for (const [name, source] of [['cotizacion', cot], ['pedido', pedido]]) {
  assert(!source.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>'), `${name}: html2canvas must not block initial parse`);
  assert(!source.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>'), `${name}: jsPDF must not block initial parse`);
  assert(source.includes('asegurarLibreriasPdf'), `${name}: lazy PDF loader missing`);
  assert(source.includes('precalentarLibreriasPdf'), `${name}: idle PDF warmup missing`);
  assert(source.includes('scale: 3'), `${name}: PDF quality scale changed unexpectedly`);
  assert(source.includes('MAX_CLIENTE_SUGERENCIAS = 10'), `${name}: suggestion bound missing`);
  assert(source.includes('clientesCacheMem'), `${name}: in-memory client cache missing`);
  const inputHandler = between(source, 'document.getElementById("cedula").addEventListener("input"', 'document.addEventListener("click"');
  assert(!inputHandler.includes('JSON.parse'), `${name}: client input hot path still parses storage`);
  assert(inputHandler.includes('setTimeout(() => renderSugerenciasCliente(valor, cont), 90)'), `${name}: client suggestions are not debounced`);
}

assert(!abono.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>'), 'abono: html2canvas must not block initial parse');
assert(!abono.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>'), 'abono: jsPDF must not block initial parse');
assert(abono.includes('MAX_ORDEN_SUGERENCIAS = 10'), 'abono: order suggestion bound missing');
assert(abono.includes('ordenesByNumber.get(String(numero))'), 'abono: exact OP lookup must use in-memory map');
assert(abono.includes('?tipo=VERIFICAR_SALDO&numeroOP='), 'abono: fresh balance verification was removed');
assert(abono.includes('?tipo=HISTORIAL_ABONOS&numeroOP='), 'abono: fresh payment history was removed');
assert(abono.includes('scale: 3'), 'abono: PDF quality scale changed unexpectedly');
const orderHandler = between(abono, 'document.getElementById("numeroOP").addEventListener("input"', 'document.addEventListener("click"');
assert(!orderHandler.includes('JSON.parse'), 'abono: order input hot path still parses storage');
assert(orderHandler.includes('renderSugerenciasOrden'), 'abono: debounced order suggestions missing');

assert(calendario.includes('groupId: grupoABorrar'), 'Calendar recurrence delete must use existing groupId batch contract');
const recurringDelete = between(calendario, "} else if (tipo === 'todos')", 'actualizarContadorVencidas');
assert((recurringDelete.match(/fetch\(WEBAPP_URL/g) || []).length === 1, 'Calendar recurring delete should perform one server request');

assert(!reportes.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>'), 'Reports must not block initial parse on html2pdf');
assert(reportes.includes('function ensureHtml2Pdf()'), 'Reports lazy html2pdf loader missing');
assert(reportes.includes('await ensureHtml2Pdf();report=buildBoardReport()'), 'Reports export must await PDF library');

for (const source of [index, core, auth, cot, pedido, abono, calendario, reportes]) {
  assert(!source.includes('serviceWorker.register'), 'Performance patch must not add service-worker business-data caching');
}

console.log('HomeEasy 10G performance safety contracts: PASS');
