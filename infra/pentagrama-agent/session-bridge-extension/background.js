'use strict';

const PORTAL = 'https://pedidos.persianaspentagrama.com/';
const LOGIN_URL = 'https://pedidos.persianaspentagrama.com/Login?ReturnUrl=%2f&homeeasy=1';
const AGENT = 'http://127.0.0.1:38461';
const COOKIE_NAMES = new Set(['.ASPXAUTH', 'ASP.NET_SessionId', 'cf_clearance']);
let loginInFlight = null;
let loginTabId = null;

async function agent(path, options = {}) {
  const response = await fetch(AGENT + path, {
    ...options,
    headers: {
      'X-HomeEasy-Session-Bridge': '1',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw Object.assign(new Error(data.error || 'HomeEasy Agent no disponible'), { code: data.code || 'AGENT_UNAVAILABLE' });
  return data;
}

async function portalCookies() {
  const all = await chrome.cookies.getAll({ url: PORTAL });
  return all.filter(cookie => COOKIE_NAMES.has(cookie.name)).map(cookie => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    expirationDate: cookie.expirationDate,
    storeId: cookie.storeId
  }));
}

function hasAuth(cookies) {
  return cookies.some(cookie => cookie.name === '.ASPXAUTH' && cookie.value);
}

async function publishSession(cookies = null) {
  const current = cookies || await portalCookies();
  if (!hasAuth(current)) return false;
  await agent('/v1/session', {
    method: 'POST',
    body: JSON.stringify({
      browser: 'Brave/Chromium extension',
      cookies: current
    })
  });
  await chrome.action.setBadgeText({ text: 'OK' });
  return true;
}

async function closeTab(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch (_) {}
  if (loginTabId === tabId) loginTabId = null;
}

async function waitForAuth(tabId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await portalCookies();
    if (hasAuth(cookies)) {
      await publishSession(cookies);
      await closeTab(tabId);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await chrome.action.setBadgeText({ text: '!' });
  await closeTab(tabId);
  return false;
}

async function ensureAuthenticated() {
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    const current = await portalCookies();
    if (hasAuth(current)) {
      await publishSession(current);
      return true;
    }

    await agent('/v1/credentials');

    if (loginTabId) {
      try {
        const existing = await chrome.tabs.get(loginTabId);
        if (existing) return waitForAuth(existing.id);
      } catch (_) {
        loginTabId = null;
      }
    }

    const existingTabs = await chrome.tabs.query({
      url: [
        'https://pedidos.persianaspentagrama.com/Login*',
        'https://pedidos.persianaspentagrama.com/User/Login*'
      ]
    });
    const existingHomeEasy = existingTabs.find(tab => String(tab.url || '').includes('homeeasy=1'));
    if (existingHomeEasy) {
      loginTabId = existingHomeEasy.id;
      return waitForAuth(existingHomeEasy.id);
    }

    const tab = await chrome.tabs.create({ url: LOGIN_URL, active: false });
    loginTabId = tab.id;
    return waitForAuth(tab.id);
  })().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

let portalTabId = null;
let browserPollRunning = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tabState(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => ({
        url: location.href,
        readyState: document.readyState,
        hasLogin: !!document.querySelector('input[name="Login"]') && !!document.querySelector('input[name="Password"]')
      })
    });
    return results && results[0] && results[0].result || null;
  } catch (_) {
    return null;
  }
}

async function waitTabReady(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.status === 'complete') {
      const state = await tabState(tabId);
      if (state && state.readyState === 'complete') return state;
    }
    await sleep(250);
  }
  throw Object.assign(new Error('Pentagrama tab did not become ready'), { code: 'PENTAGRAMA_BROWSER_TAB_TIMEOUT' });
}

async function ensurePortalTab() {
  if (portalTabId) {
    const existing = await chrome.tabs.get(portalTabId).catch(() => null);
    if (existing) return portalTabId;
    portalTabId = null;
  }

  const tabs = await chrome.tabs.query({ url: 'https://pedidos.persianaspentagrama.com/*' });
  const normal = tabs.find(tab => !tab.incognito);
  if (normal) {
    portalTabId = normal.id;
    return portalTabId;
  }

  const tab = await chrome.tabs.create({ url: PORTAL, active: false });
  portalTabId = tab.id;
  await waitTabReady(portalTabId);
  return portalTabId;
}

function freshLoginUrl(baseUrl) {
  const url = new URL(baseUrl || LOGIN_URL);
  url.searchParams.set('homeeasy', '1');
  url.searchParams.set('ha', String(Date.now()));
  return url.toString();
}

async function ensurePortalAuthenticated(tabId) {
  let state = await waitTabReady(tabId, 20000).catch(() => null);
  if (state && !state.hasLogin && !/\/(?:User\/)?Login/i.test(String(state.url || ''))) return true;

  const credentials = await agent('/v1/credentials');
  await chrome.tabs.update(tabId, { url: freshLoginUrl(credentials.loginUrl), active: false });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    state = await waitTabReady(tabId, 5000).catch(() => null);
    if (state && !state.hasLogin && !/\/(?:User\/)?Login/i.test(String(state.url || ''))) return true;
    await sleep(350);
  }
  throw Object.assign(new Error('Pentagrama login did not complete in Brave'), { code: 'PENTAGRAMA_BROWSER_SESSION_REQUIRED' });
}

async function executePortalRequest(tabId, spec) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [spec],
    func: async request => {
      const timeoutMs = Math.max(8000, Math.min(30000, Number(request && request.timeoutMs || 20000)));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: request.method || 'GET',
          headers: request.headers || {},
          body: request.body || undefined,
          credentials: 'include',
          redirect: 'follow',
          cache: 'no-store',
          signal: controller.signal
        });
        const text = await response.text();
        const headers = {};
        for (const [key, value] of response.headers.entries()) headers[key] = value;
        return {
          ok: true,
          result: {
            status: response.status,
            url: response.url,
            headers,
            text
          }
        };
      } catch (error) {
        const timedOut = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
        return {
          ok: false,
          code: timedOut ? 'PENTAGRAMA_BROWSER_REQUEST_TIMEOUT' : 'PENTAGRAMA_BROWSER_REQUEST_FAILED',
          error: timedOut ? 'Pentagrama browser request timed out' : String(error && error.message || error || 'Browser request failed'),
          infrastructure: timedOut
        };
      } finally {
        clearTimeout(timer);
      }
    }
  });
  return results && results[0] && results[0].result || {
    ok: false,
    code: 'PENTAGRAMA_BROWSER_REQUEST_FAILED',
    error: 'Brave did not return a request result'
  };
}

function resultLooksLoggedOut(value) {
  const result = value && value.result;
  if (!result) return false;
  const url = String(result.url || '');
  const text = String(result.text || '');
  return /\/(?:User\/)?Login/i.test(url) ||
    (/name=["']Login["']/i.test(text) && /name=["']Password["']/i.test(text));
}

async function runBrowserRequest(request) {
  const tabId = await ensurePortalTab();
  const maxAttempts = 3;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await ensurePortalAuthenticated(tabId);

    let result = await executePortalRequest(tabId, request.payload || {});
    if (resultLooksLoggedOut(result)) {
      await chrome.tabs.update(tabId, { url: freshLoginUrl(LOGIN_URL), active: false });
      await ensurePortalAuthenticated(tabId);
      result = await executePortalRequest(tabId, request.payload || {});
    }

    lastResult = result;
    if (result && result.ok !== false) return result;

    const transient = result && ['PENTAGRAMA_BROWSER_REQUEST_TIMEOUT', 'PENTAGRAMA_BROWSER_REQUEST_FAILED'].includes(String(result.code || ''));
    if (!transient || attempt >= maxAttempts) return result;

    await sleep(350 * attempt);
  }

  return lastResult || {
    ok: false,
    code: 'PENTAGRAMA_BROWSER_REQUEST_FAILED',
    error: 'Pentagrama browser request did not return a result'
  };
}

async function browserPollLoop() {
  if (browserPollRunning) return;
  browserPollRunning = true;
  try {
    while (true) {
      let envelope;
      try {
        envelope = await agent('/v1/browser/request?wait=25000');
      } catch (_) {
        await sleep(1500);
        continue;
      }
      const request = envelope && envelope.request;
      if (!request) continue;

      let result;
      try {
        result = await runBrowserRequest(request);
      } catch (error) {
        result = {
          ok: false,
          code: String(error && error.code || 'PENTAGRAMA_BROWSER_REQUEST_FAILED'),
          error: String(error && error.message || 'Browser request failed'),
          infrastructure: true
        };
      }

      try {
        await agent('/v1/browser/request/' + encodeURIComponent(request.id) + '/result', {
          method: 'POST',
          body: JSON.stringify(result)
        });
      } catch (_) {}
    }
  } finally {
    browserPollRunning = false;
  }
}

async function reconcile() {
  try {
    await agent('/v1/status');
    await chrome.action.setBadgeText({ text: '' });
    browserPollLoop();
  } catch (_) {
    await chrome.action.setBadgeText({ text: '?' });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('homeeasy-session-health', { periodInMinutes: 0.5 });
  reconcile();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('homeeasy-session-health', { periodInMinutes: 0.5 });
  reconcile();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'homeeasy-session-health') reconcile();
});

chrome.cookies.onChanged.addListener(changeInfo => {
  const cookie = changeInfo.cookie;
  if (!cookie || !COOKIE_NAMES.has(cookie.name)) return;
  if (!String(cookie.domain || '').includes('persianaspentagrama.com')) return;
  setTimeout(reconcile, 250);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'HOMEEASY_LOGIN_PAGE_READY') return;
  agent('/v1/credentials')
    .then(credentials => sendResponse({
      ok: true,
      login: credentials.login,
      password: credentials.password
    }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked.addListener(() => reconcile());

chrome.alarms.create('homeeasy-session-health', { periodInMinutes: 0.5 });
reconcile();
