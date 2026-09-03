'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const WAHA_PORT = 39101;
const BRIDGE_PORT = 39102;
const TEST_PHONE = '573001112233';

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

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
  const expectedPath = `/api/homeeasy/chats/${TEST_PHONE}@c.us/messages`;
  if (req.method === 'GET' && decodeURIComponent(url.pathname) === expectedPath) {
    assert.equal(url.searchParams.get('downloadMedia'), 'false');
    assert.equal(url.searchParams.get('limit'), '20');
    return json(res, 200, [
      {
        id: 'out-1',
        timestamp: 1788296400,
        fromMe: true,
        body: 'Te compartimos tu Cotización COT-32.',
        hasMedia: true,
        media: { mimetype: 'application/pdf', filename: 'Cotizacion_COT-32.pdf' },
        ackName: 'READ'
      },
      {
        id: 'out-2',
        timestamp: 1788296460,
        fromMe: true,
        body: 'Quedamos atentos a cualquier duda.',
        hasMedia: false
      }
    ]);
  }
  return json(res, 404, { error: 'fake route not found', path: url.pathname });
});

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
  await new Promise((resolve, reject) => {
    fakeWaha.once('error', reject);
    fakeWaha.listen(WAHA_PORT, '127.0.0.1', resolve);
  });

  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(BRIDGE_PORT),
      WAHA_BASE_URL: `http://127.0.0.1:${WAHA_PORT}`,
      WAHA_API_KEY: 'test-waha-key',
      WAHA_SESSION: 'homeeasy',
      BRIDGE_TOKEN: 'test-bridge-token',
      DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForBridge();
    const url = new URL(`http://127.0.0.1:${BRIDGE_PORT}/api/whatsapp/conversation`);
    url.searchParams.set('phone', '3001112233');
    url.searchParams.set('reference', 'COT-32');
    url.searchParams.set('limit', '20');
    const response = await fetch(url, {
      headers: { 'X-HomeEasy-Token': 'test-bridge-token' }
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.source, 'WAHA_WEBJS');
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].direction, 'OUTGOING');
    assert.equal(payload.messages[1].text, 'Quedamos atentos a cualquier duda.');
    assert.equal(payload.evidence.incomingCount, 0);
    assert.equal(payload.evidence.outgoingCount, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'phone'), false);
    assert.ok(!JSON.stringify(payload).includes('573001112233@c.us'));
    console.log('WhatsApp conversation endpoint smoke test: PASS');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => fakeWaha.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
