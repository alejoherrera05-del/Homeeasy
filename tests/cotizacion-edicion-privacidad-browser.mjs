import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Real browser/PDF generation with an isolated, in-memory backend. No live clients.
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = process.env.HOMEEASY_QUOTE_QA_OUTPUT || path.join(root, 'qa', 'cotizacion-edicion-privacidad');
fs.mkdirSync(output, { recursive: true });
const origin = 'http://127.0.0.1:4173';
const config = {
  empresa: {
    nombre_comercial: 'HOMEEASY QA', nit: '900000000-0', nit_formateado: '900.000.000-0',
    direccion: 'DIRECCIÓN DE PRUEBA', ciudad: 'Popayán', telefono: '3000000000',
    instagram: '@homeeasypopayan', web: 'www.homeeasy.com.co'
  },
  documentos: {
    mostrar_email: false, mostrar_web: false, mostrar_instagram: true,
    cotizacion: { titulo: 'COTIZACIÓN', validez_dias: '15', medicion_instalacion: 'Instalación de prueba.', forma_pago: 'Condición comercial QA.' },
    pedido: { titulo: 'ORDEN DE PEDIDO' },
    pie_principal: 'HOMEEASY - VISTE TU HOGAR CON ESTILO',
    pie_sistema: 'Documento generado automáticamente - Sistema Hommy V3.0'
  }
};

function initialRecord(flags) {
  const items = [311656, 279800].map((precio, i) => {
    const location = 'Habitación ' + (i + 1);
    const fabric = 'Blackout Matte blanco';
    const measures = i === 0 ? '1,05 × 1,80 m' : '1,10 × 1,40 m';
    const descripcion = [location, 'Persiana enrollable', fabric, measures].join(' · ');
    return {
      descripcion, cantidad: 1, precio, subtotal: precio, presentacion: 'individual',
      visibilidadCliente: flags, notasTecnicasInternas: true,
      detallePublico: {
        original: descripcion,
        sinMedidas: [location, 'Persiana enrollable', fabric].join(' · '),
        sinTelas: [location, 'Persiana enrollable', measures].join(' · '),
        sinAmbas: [location, 'Persiana enrollable'].join(' · ')
      }
    };
  });
  return {
    status: 'found', numero: 56, numero_cotizacion: 56, fecha: '2026-11-20T12:00:00Z',
    cedula: 'QA-900000000', nombre: 'CLIENTE FICTICIO QA', telefono: '3000000000',
    email: 'qa@example.test', direccion: 'DIRECCIÓN SIMULADA',
    observaciones: 'Detalles de instalación: Blackout Matte blanco, 1,05 × 1,80 m, mando derecho.',
    total: 591456, itemsJSON: JSON.stringify(items)
  };
}

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const stubs = new Set(['homeeasy-page-guard.js', 'homeeasy-runtime.js', 'homeeasy-runtime-cache.js', 'homeeasy-back.js', 'homeeasy-header.js']);

async function serveOffline(context) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    const base = path.basename(url.pathname);
    const fulfill = (file, contentType) => route.fulfill({ status: 200, contentType: contentType || types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    if (url.origin === origin) {
      if (base === 'homeeasy-core.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.HomeEasyCore={getConfiguration:async()=>({status:"ok",source:"network",version:4,configuracion:window.__QA_CONFIG})};' });
      if (stubs.has(base)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '// Auth and navigation are inert in isolated QA only.' });
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
      return fulfill(file);
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('bootstrap')) return fulfill(require.resolve('bootstrap/dist/css/bootstrap.min.css'));
    if (url.hostname === 'cdnjs.cloudflare.com') {
      if (url.pathname.includes('/html2canvas/')) return fulfill(require.resolve('html2canvas/dist/html2canvas.min.js'));
      if (url.pathname.includes('/jspdf/')) return fulfill(require.resolve('jspdf/dist/jspdf.umd.min.js'));
      if (url.pathname.endsWith('/css/all.min.css')) return fulfill(require.resolve('@fortawesome/fontawesome-free/css/all.min.css'));
      if (url.pathname.includes('/webfonts/')) return fulfill(path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free', 'webfonts', base));
    }
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({
      status: 200, contentType: 'text/css', body: [300, 400, 500, 600, 700, 800].map(weight => '@font-face{font-family:Montserrat;src:url("' + origin + '/node_modules/@fontsource/montserrat/files/montserrat-latin-' + weight + '-normal.woff2") format("woff2");font-weight:' + weight + ';}').join('\n')
    });
    return route.abort('blockedbyclient');
  });
}

async function installBackend(context, record) {
  await context.addInitScript(({ initial, settings }) => {
    window.__QA_CONFIG = settings;
    window.__QA_POSTS = [];
    const key = 'isolated-qa-saved-quote';
    const upstream = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(String(input), location.href);
      if (url.hostname !== 'script.google.com') return upstream(input, init);
      const reply = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null') || initial;
      if (String(init.method || 'GET').toUpperCase() === 'POST') {
        const payload = JSON.parse(init.body);
        window.__QA_POSTS.push(payload);
        if (payload.tipo === 'edit_cotizacion') sessionStorage.setItem(key, JSON.stringify({ ...saved, ...payload }));
        return reply({ status: 'success' });
      }
      if (url.searchParams.get('tipo') === 'EDITAR_COT' || url.searchParams.has('convertirCot')) return reply({ ...saved, status: 'found' });
      if (url.searchParams.has('nextPedido')) return reply({ status: 'ok', nextPedido: 174 });
      if (url.searchParams.has('init')) return reply({ status: 'ok', clientes: [{ cedula: initial.cedula, nombre: initial.nombre, telefono: initial.telefono, email: initial.email, direccion: initial.direccion }] });
      return reply({ status: 'ok', configuracion: settings });
    };
  }, { initial: record, settings: config });
}

async function captureRealPdfClone(page) {
  await page.evaluate(async () => {
    await asegurarLibreriasPdf();
    const original = window.html2canvas;
    window.html2canvas = (element, options) => original(element, {
      ...options,
      onclone(clone) {
        options.onclone(clone);
        const area = clone.getElementById('area-pdf');
        const unitHeader = area.querySelector('thead th:nth-child(3)');
        window.__QA_PDF_CLONE = {
          descriptions: [...area.querySelectorAll('#tabla-body .row-desc')].map(el => el.textContent),
          notesHidden: clone.getElementById('notas')?.closest('.mb-4')?.style.display === 'none',
          unitHidden: clone.defaultView.getComputedStyle(unitHeader).display === 'none'
        };
      }
    });
  });
}

async function openQuote(page) {
  await page.goto(origin + '/cotizacion.html?edit=56', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#tabla-body .row-desc').length === 2 && !document.documentElement.classList.contains('homeeasy-docs-loading'));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#nombre').inputValue(), 'CLIENTE FICTICIO QA');
  assert.equal(await page.locator('#total_val').innerText(), '$ 591.456');
}

const browser = await chromium.launch({ headless: true, ...(process.env.HOMEEASY_QA_CHROMIUM ? { executablePath: process.env.HOMEEASY_QA_CHROMIUM } : {}) });
const report = [];
try {
  for (const scenario of [
    { label: 'desktop', viewport: { width: 1365, height: 1000 }, flags: { hideMeasures: true, hideUnitPrices: true, hideFabrics: true } },
    { label: 'mobile', viewport: { width: 390, height: 844 }, flags: { hideMeasures: true, hideUnitPrices: true, hideFabrics: false } }
  ]) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
    await serveOffline(context);
    const initial = initialRecord(scenario.flags);
    await installBackend(context, initial);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push('Unexpected dialog: ' + dialog.message()); await dialog.dismiss(); });
    await openQuote(page);
    await captureRealPdfClone(page);
    const updated = JSON.parse(initial.itemsJSON).map(item => item.descripcion.replace(' · Persiana enrollable', '').replace('Habitación', 'HABITACIÓN'));
    for (let i = 0; i < updated.length; i++) await page.locator('#tabla-body .row-desc').nth(i).fill(updated[i]);

    await page.locator('#btnProcesar').click();
    await page.locator('#quote-privacy-review').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__QA_POSTS.length), 0, 'No POST before review');
    assert.equal(await page.locator('#quote-privacy-review textarea').count(), 2);
    await page.screenshot({ path: path.join(output, scenario.label + '-review.png'), fullPage: false });
    const bounds = await page.locator('#quote-privacy-review').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= scenario.viewport.width + 1, 'Dialog fits viewport width');
    assert(bounds.y >= 0 && bounds.y + bounds.height <= scenario.viewport.height + 1, 'Dialog fits viewport height');
    await page.locator('#quote-privacy-cancel').click();
    await page.waitForFunction(() => !document.getElementById('quote-privacy-review'));
    assert.equal(await page.evaluate(() => window.__QA_POSTS.length), 0, 'Cancel never saves');
    assert.deepEqual(await page.locator('#tabla-body .row-desc').evaluateAll(elements => elements.map(el => el.value)), updated, 'Cancel keeps edits');

    await page.locator('#btnProcesar').click();
    await page.locator('#quote-privacy-review').waitFor({ state: 'visible' });
    const publicText = ['HABITACIÓN 1', 'HABITACIÓN 2'].map(room => room + ' · ' + (scenario.flags.hideFabrics ? 'Persiana enrollable blanca' : 'Blackout Matte blanco'));
    for (let i = 0; i < 2; i++) await page.locator('#quote-privacy-input-' + i).fill(publicText[i]);
    await page.locator('#quote-privacy-save').click();
    await page.waitForFunction(() => window.__QA_POSTS.length === 1 && Boolean(window.__QA_POSTS[0].pdfBase64));
    const saved = await page.evaluate(() => window.__QA_POSTS[0]);
    const clone = await page.evaluate(() => window.__QA_PDF_CLONE);
    const items = JSON.parse(saved.itemsJSON);
    assert.equal(saved.tipo, 'edit_cotizacion');
    assert.equal(saved.numero, '56');
    assert.equal(Number(saved.total), 591456);
    assert.deepEqual(items.map(item => item.descripcion), updated, 'Internal descriptions retained');
    assert.deepEqual(items.map(item => item.precio), [311656, 279800]);
    assert.deepEqual(items.map(item => item.cantidad), [1, 1]);
    assert.equal(saved.observaciones, initial.observaciones);
    assert.deepEqual(clone.descriptions, publicText, 'PDF uses reviewed descriptions');
    assert(clone.notesHidden && clone.unitHidden, 'Requested private notes and unit prices stay hidden');
    assert(clone.descriptions.every(text => !text.includes(' × ')), 'No dimensions in protected PDF');
    if (scenario.flags.hideFabrics) assert(clone.descriptions.every(text => !text.includes('Blackout Matte')), 'No fabric reference in protected PDF');
    for (let i = 0; i < items.length; i++) {
      assert.deepEqual(items[i].visibilidadCliente, scenario.flags);
      assert.equal(items[i].detallePublico.original, updated[i]);
      assert.equal(items[i].detallePublico[scenario.flags.hideFabrics ? 'sinAmbas' : 'sinMedidas'], publicText[i]);
    }
    const pdf = Buffer.from(saved.pdfBase64, 'base64');
    assert(pdf.length > 15000 && pdf.subarray(0, 4).toString() === '%PDF');
    fs.writeFileSync(path.join(output, scenario.label + '-reviewed.pdf'), pdf);

    await openQuote(page);
    assert.deepEqual(await page.locator('#tabla-body .row-desc').evaluateAll(elements => elements.map(el => el.value)), updated);
    await captureRealPdfClone(page);
    await page.locator('#btnProcesar').click();
    await page.waitForFunction(() => window.__QA_POSTS.length === 1);
    assert.equal(await page.locator('#quote-privacy-review').count(), 0, 'Reopen/save needs no repeated review');
    assert.deepEqual(JSON.parse(await page.evaluate(() => window.__QA_POSTS[0].itemsJSON)), items, 'Round trip preserves metadata');
    assert.deepEqual(await page.evaluate(() => window.__QA_PDF_CLONE.descriptions), publicText);

    await page.goto(origin + '/pedido.html?cotizacion=56', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#tabla-body .row-desc').length === 2 && !document.documentElement.classList.contains('homeeasy-docs-loading'));
    const order = await page.evaluate(() => ({
      descriptions: [...document.querySelectorAll('#tabla-body .row-desc')].map(el => el.value),
      prices: [...document.querySelectorAll('#tabla-body .precio')].map(el => Number(el.value.replace(/\D/g, ''))),
      quantities: [...document.querySelectorAll('#tabla-body .cant')].map(el => Number(el.value)),
      notes: document.getElementById('notas').value,
      unitVisible: getComputedStyle(document.querySelector('thead th:nth-child(3)')).display !== 'none'
    }));
    assert.deepEqual(order.descriptions, updated, 'Order conversion retains technical descriptions');
    assert.deepEqual(order.prices, [311656, 279800]);
    assert.deepEqual(order.quantities, [1, 1]);
    assert.equal(order.notes, initial.observaciones);
    assert(order.unitVisible);

    // A new manual line has no old public metadata: required review is recoverable.
    await openQuote(page);
    await page.getByRole('button', { name: '+ Añadir Línea' }).click();
    await page.locator('#tabla-body .row-desc').nth(2).fill('Producto nuevo · Tela privada QA · 2,00 × 2,50 m');
    await page.locator('#btnProcesar').click();
    await page.locator('#quote-privacy-review').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#quote-privacy-review textarea').count(), 1);
    assert.equal(await page.locator('#quote-privacy-input-2').inputValue(), '');
    await page.locator('#quote-privacy-save').click();
    assert.equal(await page.evaluate(() => window.__QA_POSTS.length), 0, 'Empty review cannot save');
    assert.equal(await page.locator('#quote-privacy-input-2').evaluate(el => el.validity.valueMissing), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('quote-privacy-review'));
    assert.equal(await page.locator('#tabla-body .row-desc').count(), 3, 'Escape keeps manual line');
    assert.equal(await page.evaluate(() => window.__QA_POSTS.length), 0);
    assert.deepEqual(errors, [], 'No browser errors');
    report.push({ scenario: scenario.label, flags: scenario.flags, total: 591456, pdfBytes: pdf.length, modal: bounds, passed: ['review-before-post', 'cancel-preserves-form', 'reviewed-pdf', 'internal-integrity', 'save-reopen-save', 'order-conversion', 'manual-line-required', 'escape-preserves-form'] });
    console.log('PASS ' + scenario.label + ': edit/review/cancel/save/PDF/reopen/order/manual-line');
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
