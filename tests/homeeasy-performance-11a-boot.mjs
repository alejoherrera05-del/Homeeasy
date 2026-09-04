import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const runtime = fs.readFileSync('homeeasy-runtime.js', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const exactMessages = [
  'Hommy está despertando...',
  'Limpiando sus ojitos...',
  'Preparándose un café virtual...',
  'Ajustando su gorra...'
];
for (const text of exactMessages) {
  assert(index.includes(text), `Splash message changed or disappeared: ${text}`);
}

assert(index.includes('{ tiempo: 100,  progreso: "18%", texto: "Hommy está despertando..." }'), 'First Hommy scene/timing changed');
assert(index.includes('{ tiempo: 1500, progreso: "45%", texto: "Limpiando sus ojitos..." }'), 'Second Hommy scene/timing changed');
assert(index.includes('{ tiempo: 3000, progreso: "75%", texto: "Preparándose un café virtual..." }'), 'Third Hommy scene/timing changed');
assert(index.includes('{ tiempo: 4500, progreso: "90%", texto: "Ajustando su gorra..." }'), 'Fourth Hommy scene/timing changed');
assert(index.includes('¡Hommy está listo!'), 'Ready message changed');

assert(index.includes('<script src="homeeasy-runtime.js?v=11a0"></script>'), '11A runtime is not loaded');
assert(index.includes('const HOMEEASY_BOOT_MIN_VISUAL_MS = 5200;'), 'Splash is not preserving the useful visual window');
assert(index.includes('const HOMEEASY_BOOT_FAILOVER_MS = 9000;'), 'Boot failover budget missing');
assert(index.includes('cerrarIntroCuandoBootEsteListo(warmPromise);'), 'Index does not coordinate splash closure with warm-up');
assert(!index.includes('cerrarIntroCuandoAuthEsteLista();'), 'Old auth-only splash closure still active');

assert(runtime.includes("const VERSION = '11A.0';"), 'Runtime version missing');
assert(runtime.includes('const inFlight = new Map();'), 'In-flight request deduplication missing');
assert(runtime.includes("requestJson(`${apiUrl}?init=LOAD`)"), 'Existing bootstrap warm read missing');
assert(runtime.includes("requestJson(`${apiUrl}?tipo=EVENTOS_TODOS`)"), 'Existing agenda warm read missing');
assert(runtime.includes('Promise.allSettled([bootstrapPromise, agendaPromise])'), 'Bootstrap and agenda are not concurrent');
assert(runtime.includes("safeSet(global.localStorage, 'CACHE_CLIENTES'"), 'Client cache compatibility broken');
assert(runtime.includes("safeSet(global.localStorage, 'CACHE_ORDENES'"), 'Order cache compatibility broken');
assert(runtime.includes("safeSet(global.localStorage, 'CACHE_EVENTOS'"), 'Agenda cache compatibility broken');
assert(runtime.includes("['clientes.html', 'cotizacion.html', 'pedido.html', 'seguimiento.html', 'abono.html']"), 'Predictive page prefetch manifest missing');

for (const forbidden of [
  'VERIFICAR_SALDO',
  'movimiento_caja',
  'ACTUALIZAR_ESTADO_SEGUIMIENTO_IA',
  'REGISTRAR_EVENTO_SEGUIMIENTO',
  '/api/whatsapp/send-followup'
]) {
  assert(!runtime.includes(forbidden), `11A boot runtime must remain read-only: ${forbidden}`);
}

assert(!runtime.includes('setInterval('), 'Boot runtime must not create a polling loop');
assert(!runtime.includes('serviceWorker'), '11A.0 must not introduce a service worker');

console.log('HomeEasy Performance 11A boot contracts: PASS');
