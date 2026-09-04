import fs from 'node:fs';
import vm from 'node:vm';

const cacheSource = fs.readFileSync('homeeasy-runtime-cache.js', 'utf8');
const pages = ['index.html', 'clientes.html', 'cotizacion.html', 'pedido.html'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('<script src="homeeasy-runtime.js?v=11a0"></script>'), `${file}: base 11A runtime missing`);
  assert(html.includes('<script src="homeeasy-runtime-cache.js?v=11a2"></script>'), `${file}: 11A.2 cache extension missing`);
  if (file !== 'index.html') {
    const core = html.indexOf('<script src="homeeasy-core.js?v=3.5"></script>');
    const runtime = html.indexOf('<script src="homeeasy-runtime.js?v=11a0"></script>');
    const cache = html.indexOf('<script src="homeeasy-runtime-cache.js?v=11a2"></script>');
    const guard = html.indexOf('<script src="homeeasy-page-guard.js?v=3.6"></script>');
    assert(core >= 0 && core < runtime && runtime < cache && cache < guard,
      `${file}: security order must stay Core -> Runtime -> Cache -> Page Guard`);
  }
}

const index = fs.readFileSync('index.html', 'utf8');
for (const text of [
  'Hommy está despertando...',
  'Limpiando sus ojitos...',
  'Preparándose un café virtual...',
  'Ajustando su gorra...',
  '¡Hommy está listo!'
]) {
  assert(index.includes(text), `11A.2 changed Hommy splash text: ${text}`);
}

for (const required of [
  "const VERSION = '11A.2';",
  "const TARGET_PAGES = new Set(['clientes.html', 'cotizacion.html', 'pedido.html']);",
  "const AUTH_SESSION_KEY = 'HOMEEASY_AUTH_SESSION_V1';",
  "return 'clients-list';",
  "return 'bootstrap-clients';",
  "url.searchParams.get('listaClientes') === '1'",
  "url.searchParams.get('init') === 'LOAD'",
  'backgroundRevalidate(kind, rawUrl, options);',
  'readClients,',
  'searchClients,',
  'invalidateClientFreshness: invalidateClients'
]) {
  assert(cacheSource.includes(required), `11A.2 contract missing: ${required}`);
}

for (const forbidden of [
  'HISTORIAL_CLIENTE',
  'VERIFICAR_SALDO',
  'movimiento_caja',
  'serviceWorker',
  'setInterval('
]) {
  assert(!cacheSource.includes(forbidden), `11A.2 cache extension must not own sensitive/live route: ${forbidden}`);
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const now = Date.now();
const localStorage = storage({
  HOMEEASY_RUNTIME_BOOT_META_V1: JSON.stringify({
    version: '11A.0',
    cacheVersion: '11A.2',
    userScope: 'uid:qa-user',
    savedAt: now,
    clients: 1,
    orders: 0,
    events: 0,
    bootstrapOk: true,
    agendaOk: true
  }),
  CACHE_CLIENTES: JSON.stringify({
    '123': {
      cedula: '123',
      nombre: 'Cliente QA',
      telefono: '3000000000',
      email: 'qa@example.test',
      direccion: 'QA'
    }
  })
});
const sessionStorage = storage({
  HOMEEASY_AUTH_SESSION_V1: JSON.stringify({ profile: { uid: 'qa-user' } })
});

let networkCalls = 0;
const liveFetch = async () => {
  networkCalls += 1;
  return new Response(JSON.stringify({
    status: 'ok',
    clientes: [{ cedula: 'LIVE', nombre: 'Live' }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const window = {
  location: {
    pathname: '/clientes.html',
    href: 'https://app.example.test/clientes.html'
  },
  localStorage,
  sessionStorage,
  fetch: liveFetch,
  HomeEasyCore: { API_URL: 'https://api.example.test/exec' },
  HomeEasyRuntime: Object.freeze({
    version: '11A.0',
    async warmIndex() { return { status: 'fresh-cache' }; },
    readMeta() { return JSON.parse(localStorage.getItem('HOMEEASY_RUNTIME_BOOT_META_V1')); }
  }),
  dispatchEvent() {}
};

const context = vm.createContext({
  window,
  URL,
  Response,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  console,
  Promise,
  Object,
  Set,
  Map,
  JSON,
  Date,
  String,
  Number
});
vm.runInContext(cacheSource, context, { filename: 'homeeasy-runtime-cache.js' });

const cached = await window.fetch('https://api.example.test/exec?listaClientes=1');
const cachedData = await cached.json();
assert(cachedData.source === 'runtime-cache', 'clientes.html did not use warmed runtime cache');
assert(Array.isArray(cachedData.clientes) && cachedData.clientes[0].cedula === '123', 'cached clientes payload is not equivalent');
assert(networkCalls === 0, 'fresh scoped cache unexpectedly hit network');

window.location.pathname = '/cotizacion.html';
const bootstrap = await window.fetch('https://api.example.test/exec?init=LOAD');
const bootstrapData = await bootstrap.json();
assert(bootstrapData.source === 'runtime-cache', 'cotizacion.html did not use warmed runtime cache');
assert(Array.isArray(bootstrapData.clientes) && bootstrapData.clientes[1][0] === '123',
  'bootstrap cache did not preserve row-shaped client contract');
assert(window.HomeEasyRuntime.searchClients('cliente qa')[0].cedula === '123',
  'shared client search index did not return warmed client');

localStorage.setItem('HOMEEASY_RUNTIME_BOOT_META_V1', JSON.stringify({
  cacheVersion: '11A.2',
  userScope: 'uid:other-user',
  savedAt: Date.now(),
  bootstrapOk: true
}));
window.location.pathname = '/clientes.html';
await window.fetch('https://api.example.test/exec?listaClientes=1');
assert(networkCalls === 1, 'cache was served across user scopes');

console.log('HomeEasy Performance 11A.2 runtime cache contracts: PASS');
