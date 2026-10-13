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

async function reconcile() {
  try {
    const status = await agent('/v1/status');
    const cookies = await portalCookies();
    if (hasAuth(cookies)) {
      await publishSession(cookies);
      return;
    }
    if (status.loginRequested) await ensureAuthenticated();
    else await chrome.action.setBadgeText({ text: '' });
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
