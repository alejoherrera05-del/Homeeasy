'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const WAHA_PORT = 39201;
const BRIDGE_PORT = 39202;
const HOMEEASY_PORT = 39203;
const TEST_PHONE = '573001112233';
let conversationMode = 'quiet';
let followupState = 'ACTIVE';
let followupMode = 'REVIEW';
let currentVersion = 7;
let sendCount = 0;

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
  assert.equal(payload.meta.dispositivoId, 'device-qa');

  if (payload.tipo === 'AUTH_VALIDAR_SESION') {
    const readOnly = payload.appSessionToken === 'read-session';
    return json(res, 200, {
      status: 'success',
      valido: true,
      perfil: {
        uid: readOnly ? 'qa-read' : 'qa-write',
        nombre: 'Alejandro QA',
        email: 'qa@example.invalid',
        rol: 'ADMINISTRADOR',
        estado: 'ACTIVO'
      },
      permisos: readOnly
        ? ['app.access', 'cotizaciones.read']
        : ['app.access', 'cotizaciones.read', 'cotizaciones.write']
    });
  }

  if (payload.tipo === 'GET_SEGUIMIENTO_DETALLE') {
    assert.equal(String(payload.numero), '32');
    return json(res, 200, {
      status: 'ok',
      cotizacion: {
        numero: 32,
        fecha: '2026-08-31T18:17:13-05:00',
        nombre: 'KAREN CORDERO',
        estado: 'COTIZACION'
      },
      cliente: { telefono: '3001112233' },
      seguimiento: {
        telefono: '3001112233',
        modo: followupMode,
        estado: followupState,
        intencion: 'NO_RESPONSE',
        estadoVersion: currentVersion
      },
      timeline: [],
      timelineTotal: 0
    });
  }

  return json(res, 400, { status: 'error', code: 'UNEXPECTED_TYPE' });
});

const fakeWaha = http.createServer(async (req, res) => {
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

  if (req.method === 'GET' && decodeURIComponent(url.pathname) === `/api/homeeasy/lids/pn/${TEST_PHONE}`) {
    return json(res, 404, { error: 'not mapped' });
  }

  if (req.method === 'GET' && url.pathname === '/api/contacts') {
    return json(res, 404, { error: 'not found' });
  }

  if (req.method === 'GET' && decodeURIComponent(url.pathname) === `/api/homeeasy/chats/${TEST_PHONE}@c.us/messages`) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    if (conversationMode === 'changed') {
      return json(res, 200, [{
        id: 'incoming-new',
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: false,
        body: 'Hola, justo acabo de responder.'
      }]);
    }
    return json(res, 200, []);
  }

  if (req.method === 'POST' && url.pathname === '/api/sendText') {
    const payload = await bodyJson(req);
    assert.equal(payload.session, 'homeeasy');
    assert.equal(payload.chatId, `${TEST_PHONE}@c.us`);
    assert.equal(payload.text, 'Hola Karen 😊 Quería saber si alcanzaste a revisar la propuesta.');
    sendCount += 1;
    return json(res, 200, { id: `msg-${sendCount}` });
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

function headers(token = 'write-session') {
  return {
    'Content-Type': 'application/json',
    'X-HomeEasy-Session': token,
    'X-HomeEasy-Device-Id': 'device-qa',
    'X-HomeEasy-Device-Name': 'QA Browser',
    'X-HomeEasy-Platform': 'QA',
    'X-HomeEasy-Browser': 'Chromium'
  };
}

async function send(body, token) {
  const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/whatsapp/send-followup`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body)
  });
  return { response, payload: await response.json() };
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-wa-followup-'));
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
    const base = {
      reference: 'COT-32',
      text: 'Hola Karen 😊 Quería saber si alcanzaste a revisar la propuesta.',
      planId: 'FUP-ABCDEF123456',
      expectedVersion: 7,
      generatedAt: new Date(Date.now() - 5000).toISOString(),
      phone: '573999999999'
    };

    const first = await send(base);
    assert.equal(first.response.status, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.ok, true);
    assert.equal(first.payload.delivery, 'SENT');
    assert.equal(first.payload.duplicate, false);
    assert.equal(first.payload.messageId, 'msg-1');
    assert.equal(Object.prototype.hasOwnProperty.call(first.payload, 'phone'), false);
    assert.equal(sendCount, 1);

    const duplicate = await send(base);
    assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.payload));
    assert.equal(duplicate.payload.duplicate, true);
    assert.equal(duplicate.payload.messageId, 'msg-1');
    assert.equal(sendCount, 1, 'idempotent retry must not send again');

    const stale = await send({ ...base, planId: 'FUP-STALE123456', expectedVersion: 6 });
    assert.equal(stale.response.status, 409, JSON.stringify(stale.payload));
    assert.equal(stale.payload.details.code, 'FOLLOWUP_STATE_CHANGED');
    assert.equal(sendCount, 1);

    conversationMode = 'changed';
    const changed = await send({
      ...base,
      planId: 'FUP-CHANGED12345',
      generatedAt: new Date(Date.now() - 10000).toISOString()
    });
    assert.equal(changed.response.status, 409, JSON.stringify(changed.payload));
    assert.equal(changed.payload.details.code, 'FOLLOWUP_CONVERSATION_CHANGED');
    assert.equal(sendCount, 1);
    conversationMode = 'quiet';

    followupState = 'STOPPED';
    const stopped = await send({ ...base, planId: 'FUP-STOPPED12345' });
    assert.equal(stopped.response.status, 409, JSON.stringify(stopped.payload));
    assert.equal(stopped.payload.details.code, 'FOLLOWUP_NOT_SENDABLE');
    assert.equal(sendCount, 1);
    followupState = 'ACTIVE';

    followupMode = 'AUTO';
    const wrongMode = await send({ ...base, planId: 'FUP-MODE12345678' });
    assert.equal(wrongMode.response.status, 409, JSON.stringify(wrongMode.payload));
    assert.equal(wrongMode.payload.details.code, 'FOLLOWUP_REVIEW_MODE_REQUIRED');
    assert.equal(sendCount, 1);
    followupMode = 'REVIEW';

    const forbidden = await send({ ...base, planId: 'FUP-READONLY1234' }, 'read-session');
    assert.equal(forbidden.response.status, 403, JSON.stringify(forbidden.payload));
    assert.equal(sendCount, 1);

    const activity = JSON.parse(fs.readFileSync(path.join(dataDir, 'activity.json'), 'utf8'));
    const followups = activity.filter(item => item.kind === 'followup');
    assert.equal(followups.length, 1);
    assert.equal(followups[0].reference, 'COT-32');
    assert.equal(followups[0].documentType, 'cotizacion');
    assert.equal(followups[0].messageId, 'msg-1');

    console.log('WhatsApp 10D human-approved follow-up send smoke test: PASS');
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
