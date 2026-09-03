'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const WAHA_PORT = 39101;
const BRIDGE_PORT = 39102;
const HOMEEASY_PORT = 39103;
const TEST_PHONE = '573001112233';
const TEST_LID = '123456789012345@lid';

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const fakeHomeEasy = http.createServer(async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { status: 'error' });
  const payload = await bodyJson(req);
  assert.equal(payload.appSessionToken, 'test-session');
  assert.equal(payload.meta.dispositivoId, 'device-qa');

  if (payload.tipo === 'AUTH_VALIDAR_SESION') {
    return json(res, 200, {
      status: 'success',
      valido: true,
      perfil: {
        uid: 'qa-user',
        nombre: 'Alejandro QA',
        email: 'qa@example.invalid',
        rol: 'ADMINISTRADOR',
        estado: 'ACTIVO'
      },
      permisos: ['app.access', 'cotizaciones.read']
    });
  }

  if (payload.tipo === 'GET_SEGUIMIENTO_DETALLE') {
    assert.equal(String(payload.numero), '32');
    return json(res, 200, {
      status: 'ok',
      cotizacion: {
        numero: 32,
        fecha: '2026-08-31T18:17:13-05:00',
        estado: 'COTIZACION'
      },
      cliente: {
        telefono: '3001112233'
      },
      seguimiento: {
        telefono: '3001112233'
      },
      timeline: [],
      timelineTotal: 0
    });
  }

  return json(res, 400, { status: 'error', code: 'UNEXPECTED_TYPE' });
});

const fakeWaha = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${WAHA_PORT}`);
  assert.equal(req.headers['x-api-key'], 'test-waha-key');
  if (req.method === 'GET' && url.pathname === '/api/sessions/homeeasy') {
    return json(res, 200, {
      name: 'homeeasy',
      status: 'WORKING',
      engine: { engine: 'WEBJS' },
      me: { id: '573334319374@c.us' }
    });
  }
  const lidLookupPath = `/api/homeeasy/lids/pn/${TEST_PHONE}`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === lidLookupPath) {
    return json(res, 200, { lid: TEST_LID, pn: `${TEST_PHONE}@c.us` });
  }
  const expectedPnPath = `/api/homeeasy/chats/${TEST_PHONE}@c.us/messages`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === expectedPnPath) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.ok(Number(url.searchParams.get('filter.timestamp.gte')) > 0);
    return json(res, 200, [
      {
        id: 'out-1',
        timestamp: 1788296400,
        fromMe: true,
        body: 'Te compartimos tu Cotización COT-32.',
        hasMedia: true,
        media: { mimetype: 'application/pdf', filename: 'Cotizacion_COT-32.pdf' },
        ackName: 'READ'
      }
    ]);
  }
  const expectedLidPath = `/api/homeeasy/chats/${TEST_LID}/messages`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === expectedLidPath) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.ok(Number(url.searchParams.get('filter.timestamp.gte')) > 0);
    return json(res, 200, [
      {
        id: 'out-2',
        timestamp: 1788296460,
        key: { id: 'out-2', fromMe: true },
        body: 'Quedamos atentos a cualquier duda.',
        hasMedia: false
      }
    ]);
  }
  return json(res, 404, { error: 'fake route not found', path: url.pathname });
});

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitForBridge() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Bridge did not become ready');
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-wa-context-'));
  await listen(fakeHomeEasy, HOMEEASY_PORT);
  await listen(fakeWaha, WAHA_PORT);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(BRIDGE_PORT),
      WAHA_BASE_URL: `http://127.0.0.1:${WAHA_PORT}`,
      WAHA_API_KEY: 'test-waha-key',
      WAHA_SESSION: 'homeeasy',
      BRIDGE_TOKEN: 'test-bridge-token',
      HOMEEASY_BACKEND_URL: `http://127.0.0.1:${HOMEEASY_PORT}`,
      DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForBridge();
    const url = new URL(`http://127.0.0.1:${BRIDGE_PORT}/api/whatsapp/conversation`);
    url.searchParams.set('reference', 'COT-32');
    url.searchParams.set('limit', '20');
    // A caller-supplied phone must be ignored; the Bridge derives it from COT-32.
    url.searchParams.set('phone', '573999999999');
    const response = await fetch(url, {
      headers: {
        'X-HomeEasy-Session': 'test-session',
        'X-HomeEasy-Device-Id': 'device-qa',
        'X-HomeEasy-Device-Name': 'QA Browser',
        'X-HomeEasy-Platform': 'QA',
        'X-HomeEasy-Browser': 'Chromium'
      }
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.source, 'WAHA_WEBJS');
    assert.equal(payload.reference, 'COT-32');
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].direction, 'OUTGOING');
    assert.equal(payload.messages[1].text, 'Quedamos atentos a cualquier duda.');
    assert.equal(payload.evidence.incomingCount, 0);
    assert.equal(payload.evidence.outgoingCount, 2);
    assert.equal(payload.lookup.candidateCount, 2);
    assert.equal(payload.lookup.lidResolved, true);
    assert.equal(payload.lookup.successfulQueries, 2);
    assert.equal(payload.lookup.failedQueries, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'phone'), false);
    assert.ok(!JSON.stringify(payload).includes(TEST_PHONE));
    assert.ok(!JSON.stringify(payload).includes('573999999999'));
    console.log('WhatsApp canonical conversation endpoint smoke test: PASS');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => fakeWaha.close(resolve));
    await new Promise(resolve => fakeHomeEasy.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
