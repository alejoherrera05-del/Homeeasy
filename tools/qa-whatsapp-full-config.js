'use strict';

const assert = require('assert');
const { chromium, webkit } = require('playwright');

const BASE = 'http://127.0.0.1:4173/configuracion.html';
const SESSION_KEY = 'HOMEEASY_AUTH_SESSION_V1';
const CONFIG_KEY = 'HOMEEASY_CONFIG_BROWSER_V1';

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function seededSession() {
  const payload = {
    aud: 'homeeasy-auth',
    iss: 'https://securetoken.google.com/homeeasy-auth',
    sub: 'qa-user-1',
    user_id: 'qa-user-1',
    email: 'qa@homeeasy.test',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };
  return {
    version: 2,
    persistence: 'session',
    localId: 'qa-user-1',
    email: 'qa@homeeasy.test',
    displayName: 'QA Admin',
    idToken: `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.qa`,
    refreshToken: 'qa-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    appSessionToken: 'qa-app-session',
    appSessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    appSessionValidatedAt: Date.now(),
    profile: {
      uid: 'qa-user-1',
      nombre: 'QA Admin',
      email: 'qa@homeeasy.test',
      rol: 'ADMINISTRADOR',
      estado: 'ACTIVO',
      emailVerificado: true,
      ultimoAcceso: new Date().toISOString(),
      ultimoDispositivo: 'QA browser'
    },
    permissions: ['*', 'config.read'],
    savedAt: Date.now()
  };
}

function seededConfigCache() {
  return {
    savedAt: Date.now(),
    payload: {
      status: 'ok',
      version: 'QA-STABLE',
      actualizadoEn: new Date().toISOString(),
      configuracion: {
        empresa: {
          nombre_comercial: 'HomeEasy',
          razon_social: 'HomeEasy',
          nit: '1061760852-1',
          telefono: '3334319374',
          whatsapp: '3334319374',
          email: 'qa@homeeasy.test',
          ciudad: 'Popayán'
        },
        sistema: { version_configuracion: 'QA-STABLE', version_app: '3.0' },
        documentos: {
          pie_principal: 'HomeEasy',
          pie_sistema: 'Documento generado automáticamente • Sistema Hommy V3.0',
          cotizacion: {}, pedido: {}, recibo: {}, cuenta_cobro: {}
        },
        operacion: {}, crm: {}, caja: { nombre: 'Caja principal' }
      }
    }
  };
}

async function seed(context) {
  await context.addInitScript(({ sessionKey, configKey, session, configCache }) => {
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    localStorage.setItem(configKey, JSON.stringify(configCache));
    localStorage.setItem('HOMEEASY_DEVICE_ID', 'qa-device-12345678');
    localStorage.setItem('HOMEEASY_DEVICE_NAME', 'QA Device');
  }, {
    sessionKey: SESSION_KEY,
    configKey: CONFIG_KEY,
    session: seededSession(),
    configCache: seededConfigCache()
  });
}

async function routeHomeEasyBackend(page) {
  await page.route('https://script.google.com/**', async route => {
    const req = route.request();
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (_) {}
    const url = new URL(req.url());
    const tipo = String(body.tipo || url.searchParams.get('tipo') || '');
    let payload;
    if (tipo === 'AUTH_VALIDAR_SESION') {
      payload = {
        status: 'success', valido: true,
        perfil: seededSession().profile,
        permisos: ['*', 'config.read'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      };
    } else if (tipo === 'GET_CONFIGURACION') {
      payload = seededConfigCache().payload;
    } else {
      payload = {
        status: 'ok',
        items: [], usuarios: [], roles: [], permisos: [],
        estadisticas: { total: 0, exitosas: 0, fallidas: 0, reversibles: 0 },
        total: 0
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.route('https://script.googleusercontent.com/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', items: [] }) });
  });
}

async function waitForStableConfiguration(page) {
  await page.waitForFunction(() => window.HomeEasyPageGuard && HomeEasyPageGuard.getStatus() === 'authorized', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const version = document.getElementById('configVersion');
    const overlay = document.getElementById('syncOverlay');
    return version && version.textContent.includes('QA-STABLE') && overlay && !overlay.classList.contains('visible');
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-section="integraciones"]').length >= 2, null, { timeout: 8000 });
  assert(!page.url().includes('login.html'), 'Configuracion redirected to login');
}

async function snapshotSession(page) {
  return page.evaluate(key => sessionStorage.getItem(key), SESSION_KEY);
}

async function assertSessionUnchanged(page, before, label) {
  const after = await snapshotSession(page);
  assert.strictEqual(after, before, `${label}: HomeEasy session storage changed`);
  assert(!page.url().includes('login.html'), `${label}: redirected to login`);
  assert(await page.locator('#settingsApp').count(), `${label}: settings app disappeared`);
}

async function clickVisibleIntegrations(page) {
  const button = page.locator('[data-section="integraciones"]:visible').first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
  await page.waitForSelector('#panel-integraciones.active', { timeout: 5000 });
}

async function runScenario(browserType, browserName, viewport, mode) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport, isMobile: viewport.width <= 500, hasTouch: viewport.width <= 500 });
  await seed(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err && err.message || err)));
  await routeHomeEasyBackend(page);

  let waCalls = 0;
  await page.route('https://api.homeeasy.com.co/**', async route => {
    waCalls += 1;
    if (mode === 'connected') {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/test-message')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messageId: 'qa-text', sentAt: new Date().toISOString() }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          whatsapp: {
            exists: true, name: 'homeeasy', status: 'WORKING', ready: true, engine: 'WEBJS',
            me: { id: '573334319374@c.us', pushName: 'Homeeasy Popayán' }
          }
        })
      });
    }
    if (mode === '401') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'HomeEasy session is not valid' }) });
    }
    return route.abort('connectionfailed');
  });

  await page.goto(`${BASE}?qa=${browserName}-${mode}-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForStableConfiguration(page);
  const before = await snapshotSession(page);

  await page.waitForTimeout(1300);
  assert.strictEqual(waCalls, 0, `${browserName}/${mode}: WhatsApp was called before opening Integraciones`);
  await assertSessionUnchanged(page, before, `${browserName}/${mode} before Integraciones`);

  await clickVisibleIntegrations(page);

  if (mode === 'connected') {
    await page.waitForFunction(() => document.getElementById('heWaChip')?.textContent === 'Conectado', null, { timeout: 5000 });
    assert((await page.locator('#heWaPhone').textContent()).includes('+57'), `${browserName}: connected phone not rendered`);
    assert(waCalls >= 1, `${browserName}: connected mode never called WhatsApp`);
  } else {
    await page.waitForFunction(() => document.getElementById('heWaChip')?.textContent === 'Sin respuesta', null, { timeout: 5000 });
    const description = await page.locator('#heWaDescription').textContent();
    assert(/HomeEasy seguirá abierto|No fue posible conectar|WhatsApp/i.test(description || ''), `${browserName}/${mode}: isolated error text missing`);
  }

  await assertSessionUnchanged(page, before, `${browserName}/${mode} after WhatsApp response`);
  assert(!pageErrors.some(msg => /restoreHomeEasySession|signOut|HomeEasy session/i.test(msg)), `${browserName}/${mode}: suspicious page error: ${pageErrors.join(' | ')}`);

  if (mode === '401') {
    const callsBeforeReload = waCalls;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForStableConfiguration(page);
    await page.waitForTimeout(1200);
    assert.strictEqual(waCalls, callsBeforeReload, `${browserName}/401: WhatsApp called automatically after reload`);
    await assertSessionUnchanged(page, before, `${browserName}/401 after reload`);
  }

  console.log(`FULL_CONFIG_OK browser=${browserName} mode=${mode} waCalls=${waCalls} pageErrors=${pageErrors.length}`);
  await context.close();
  await browser.close();
}

(async () => {
  await runScenario(chromium, 'chromium-desktop', { width: 1440, height: 900 }, 'connected');
  await runScenario(chromium, 'chromium-desktop', { width: 1440, height: 900 }, '401');
  await runScenario(webkit, 'webkit-iphone', { width: 390, height: 844 }, 'connected');
  await runScenario(webkit, 'webkit-iphone', { width: 390, height: 844 }, '401');
  await runScenario(webkit, 'webkit-iphone', { width: 390, height: 844 }, 'network');
  console.log('FULL_CONFIG_WHATSAPP_ISOLATION_QA_OK');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
