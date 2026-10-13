'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function browserCandidates() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
}

function locateBrowser() {
  return browserCandidates().find(candidate => fs.existsSync(candidate)) || '';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    await delay(100);
  }
  return false;
}

async function connectWebSocket(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(Object.assign(new Error('Chromium DevTools connection timed out'), { code: 'PENTAGRAMA_BROWSER_TIMEOUT' }));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Chromium DevTools connection failed'), { code: 'PENTAGRAMA_BROWSER_UNAVAILABLE' }));
    }, { once: true });
  });
}

function cdp(ws) {
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data || '')); } catch (_) { return; }
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(Object.assign(new Error(message.error.message || 'CDP error'), { code: 'PENTAGRAMA_BROWSER_CDP_ERROR' }));
    else item.resolve(message.result || {});
  });
  return {
    call(method, params = {}, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error(`CDP ${method} timed out`), { code: 'PENTAGRAMA_BROWSER_TIMEOUT' }));
        }, timeoutMs);
        pending.set(id, {
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); }
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}

async function pageReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.call('Runtime.evaluate', {
      expression: `(() => ({
        hasLogin: !!document.querySelector('input[name="Login"]'),
        hasPassword: !!document.querySelector('input[name="Password"]'),
        url: location.href,
        title: document.title
      }))()`,
      returnByValue: true
    }).catch(() => null);
    const value = result && result.result && result.result.value;
    if (value && value.hasLogin && value.hasPassword) return value;
    await delay(350);
  }
  throw Object.assign(new Error('Pentagrama login form was not available after Cloudflare bootstrap'), {
    code: 'PENTAGRAMA_BROWSER_CLEARANCE_FAILED'
  });
}

async function cookies(client) {
  const result = await client.call('Network.getAllCookies', {});
  return Array.isArray(result.cookies) ? result.cookies.map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path
  })) : [];
}

async function browserSessionBootstrap(options = {}) {
  if (process.platform !== 'win32') {
    throw Object.assign(new Error('Browser-assisted Pentagrama login requires the Windows Agent'), { code: 'PENTAGRAMA_BROWSER_UNAVAILABLE' });
  }
  const executable = locateBrowser();
  if (!executable) {
    throw Object.assign(new Error('Brave, Chrome or Edge was not found on the Agent computer'), { code: 'PENTAGRAMA_BROWSER_UNAVAILABLE' });
  }

  const timeoutMs = Math.max(30000, Number(options.timeoutMs || 45000));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-pentagrama-browser-'));
  const devtoolsFile = path.join(profile, 'DevToolsActivePort');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank'
  ];

  const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    if (!await waitForFile(devtoolsFile, 12000)) {
      throw Object.assign(new Error('Chromium did not expose a DevTools port'), { code: 'PENTAGRAMA_BROWSER_UNAVAILABLE' });
    }
    const [port] = fs.readFileSync(devtoolsFile, 'utf8').split(/\r?\n/);
    const createUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(options.loginUrl)}`;
    const targetResponse = await fetch(createUrl, { method: 'PUT', signal: AbortSignal.timeout(8000) });
    const target = await targetResponse.json();
    if (!target.webSocketDebuggerUrl) throw Object.assign(new Error('Chromium target was not created'), { code: 'PENTAGRAMA_BROWSER_UNAVAILABLE' });

    ws = await connectWebSocket(target.webSocketDebuggerUrl, 8000);
    const client = cdp(ws);
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    await pageReady(client, timeoutMs);

    const script = `(() => {
      const login = document.querySelector('input[name="Login"]');
      const password = document.querySelector('input[name="Password"]');
      const button = document.querySelector('[name="LoginButton"]');
      if (!login || !password || !button) return { ok:false, reason:'FORM_MISSING' };
      login.value = ${JSON.stringify(String(options.login || ''))};
      login.dispatchEvent(new Event('input', { bubbles:true }));
      login.dispatchEvent(new Event('change', { bubbles:true }));
      password.value = ${JSON.stringify(String(options.password || ''))};
      password.dispatchEvent(new Event('input', { bubbles:true }));
      password.dispatchEvent(new Event('change', { bubbles:true }));
      const r = button.getBoundingClientRect();
      return { ok:true, x:r.left + r.width/2, y:r.top + r.height/2 };
    })()`;
    const prepared = await client.call('Runtime.evaluate', { expression: script, returnByValue: true });
    const point = prepared.result && prepared.result.value;
    if (!point || !point.ok || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw Object.assign(new Error('Pentagrama login form could not be prepared'), { code: 'PENTAGRAMA_BROWSER_LOGIN_FAILED' });
    }

    // Submit through a real CDP mouse gesture instead of form.requestSubmit().
    // Cloudflare treats browser navigation generated by trusted user input differently
    // from synthetic JavaScript submission; this also reproduces sec-fetch-user: ?1.
    await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });

    const deadline = Date.now() + timeoutMs;
    let latest = [];
    while (Date.now() < deadline) {
      latest = await cookies(client).catch(() => []);
      if (latest.some(cookie => cookie.name === '.ASPXAUTH')) {
        return {
          ok: true,
          browser: path.basename(executable),
          cookies: latest.filter(cookie => ['.ASPXAUTH', 'ASP.NET_SessionId', 'cf_clearance'].includes(cookie.name))
        };
      }
      await delay(350);
    }
    throw Object.assign(new Error('Pentagrama browser login did not issue .ASPXAUTH'), {
      code: 'PENTAGRAMA_BROWSER_LOGIN_FAILED',
      details: {
        browser: path.basename(executable),
        hasClearance: latest.some(cookie => cookie.name === 'cf_clearance'),
        hasSession: latest.some(cookie => cookie.name === 'ASP.NET_SessionId')
      }
    });
  } finally {
    try { if (ws) ws.close(); } catch (_) {}
    if (child && child.pid) {
      try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
    }
    await delay(250);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = Object.freeze({ browserCandidates, locateBrowser, browserSessionBootstrap });
