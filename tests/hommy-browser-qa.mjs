import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH;
assert.ok(executablePath, 'CHROME_PATH is required for browser QA');
fs.mkdirSync('qa/hommy-2-browser', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const coreStub = `
window.HomeEasyCore = {
  buildMeta() {
    return {
      operador: 'Alejandro QA',
      dispositivoId: 'device-browser-qa',
      dispositivoNombre: 'Chromium QA',
      plataforma: 'QA',
      navegador: 'Chromium',
      pagina: 'Hommychat.html',
      versionApp: '3.4',
      horaCliente: new Date().toISOString()
    };
  },
  goHome() { window.__hommyWentHome = true; }
};
window.HomeEasyAuth = {
  getCurrentProfile() {
    return { uid: 'qa-user', nombre: 'Alejandro QA', email: 'qa@example.com', rol: 'ADMIN' };
  },
  getPermissions() {
    return ['app.access', 'clientes.read', 'ventas.read', 'reportes.read', 'caja.read', 'agenda.read', 'cotizaciones.write'];
  },
  getAppSessionToken() { return 'qa-session-token'; }
};
`;

const guardStub = `
queueMicrotask(() => window.dispatchEvent(new CustomEvent('homeeasy:page-auth-ready', { detail: { authorized: true } })));
`;

async function mockPage(page) {
  await page.route('**/homeeasy-core.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: coreStub,
  }));
  await page.route('**/homeeasy-page-guard.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: guardStub,
  }));
  await page.route('https://homeeasy-l5n1.onrender.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/health') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, service: 'Hommy', version: '2.0.0' }),
      });
    }
    if (url.pathname === '/api/hommy/chat') {
      const headers = request.headers();
      assert.equal(headers['x-homeeasy-session'], 'qa-session-token');
      assert.ok(headers['x-homeeasy-meta'], 'HomeEasy device metadata header must be sent');
      const payload = request.postDataJSON();
      assert.equal(payload.message, 'prueba-xss');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          answer: '<img src=x onerror="window.__hommyXss=1"> Esto debe verse como texto.',
          conversationToken: 'signed-conversation-token',
          cards: [
            {
              type: 'customer',
              title: 'Cliente de prueba',
              subtitle: '300 000 0000',
              meta: 'Popayán',
            },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'QA route not mocked' } }),
    });
  });
}

async function runViewport(name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(String(error)));
  await mockPage(page);

  await page.goto('http://127.0.0.1:8000/Hommychat.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#service-status')?.textContent.includes('Disponible'));

  assert.equal(await page.locator('#welcome-title').textContent(), 'Hola, Alejandro.');
  assert.ok(await page.locator('.starter').count() >= 3, `${name}: expected starter actions`);
  assert.equal(await page.locator('#voice-button').isDisabled(), false, `${name}: voice should enable after health`);

  const before = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    zoomDisabled: document.querySelector('meta[name="viewport"]')?.content.includes('user-scalable=no') || false,
  }));
  assert.ok(before.scrollWidth <= before.innerWidth + 1, `${name}: horizontal overflow before chat`);
  assert.equal(before.zoomDisabled, false, `${name}: viewport must not disable zoom`);

  await page.screenshot({
    path: `qa/hommy-2-browser/${name}-welcome.png`,
    fullPage: true,
  });

  await page.locator('#message-input').fill('prueba-xss');
  assert.equal(await page.locator('#send-button').isDisabled(), false, `${name}: send should enable with text`);
  await page.locator('#send-button').click();

  const assistant = page.locator('.message-row.assistant .message-text').last();
  await assistant.waitFor({ state: 'visible' });
  assert.equal(
    await assistant.textContent(),
    '<img src=x onerror="window.__hommyXss=1"> Esto debe verse como texto.',
    `${name}: model response should render as literal text`,
  );
  assert.equal(await page.locator('img[src="x"]').count(), 0, `${name}: model HTML must not become DOM`);
  assert.equal(await page.evaluate(() => window.__hommyXss), undefined, `${name}: injected JS must never execute`);
  assert.equal(await page.locator('.hommy-card .card-title').last().textContent(), 'Cliente de prueba');

  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('HOMMY_CHAT_V2:qa-user')));
  assert.equal(stored.conversationToken, 'signed-conversation-token');
  assert.equal(stored.messages.at(-1).role, 'assistant');

  const after = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    composerBottom: document.querySelector('.composer-shell').getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
  }));
  assert.ok(after.scrollWidth <= after.innerWidth + 1, `${name}: horizontal overflow after chat`);
  assert.ok(after.composerBottom <= after.viewportHeight + 2, `${name}: composer escaped viewport`);
  assert.deepEqual(consoleErrors, [], `${name}: console/page errors: ${consoleErrors.join(' | ')}`);

  await page.screenshot({
    path: `qa/hommy-2-browser/${name}-chat.png`,
    fullPage: true,
  });

  console.log(`${name}: PASS (${viewport.width}x${viewport.height})`);
  await context.close();
}

try {
  await runViewport('desktop', { width: 1440, height: 1000 });
  await runViewport('mobile', { width: 390, height: 844 });
  console.log('ALL HOMMY BROWSER QA PASSED');
} finally {
  await browser.close();
}
