import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

// All backend traffic is fulfilled locally. No credentials, customer data or
// document writes are sent to production. PDF libraries and Core are real.
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = process.env.HOMMY_QA_OUTPUT_DIR || path.join(root, 'qa', 'cuenta-cobro-pdf');
const origin = 'http://127.0.0.1:4173';
fs.mkdirSync(output, { recursive: true });
const scenarios = [
  { name: 'desktop-manual', width: 1440, height: 1000, mode: 'MANUAL', amount: 2900000 },
  { name: 'desktop-op', width: 1440, height: 1000, mode: 'OP', amount: 1450000 },
  { name: 'mobile-manual', width: 390, height: 844, mode: 'MANUAL', amount: 2900000 },
  { name: 'mobile-op', width: 390, height: 844, mode: 'OP', amount: 1450000 }
];
const center = {
  status: 'ok',
  cuentaCobro: { proximoNumero: 'CC-2026-999', ciudad: 'Popayán' },
  documentos: [],
  empresa: { nombre: 'QA HOMMY', nit: '000000000-0', direccion: 'DIRECCIÓN QA', telefono: '0000000', instagram: '@qa' },
  banco: { nombre: 'BANCO QA', tipoCuenta: 'PRUEBA', numeroCuenta: '000000', titular: 'PERSONA QA', ccTitular: '000000' },
  representante: { nombre: 'PERSONA QA', documento: '000000' },
  firma: { texto: 'PERSONA QA' }
};
const launch = { headless: true };
if (process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(launch);
const report = { browser: browser.version(), backend: 'isolated mock; no production writes', scenarios: [] };
const rasterHashes = new Map();
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
      deviceScaleFactor: 1,
      acceptDownloads: true
    });
    page.setDefaultTimeout(25000);
    const errors = [];
    const alerts = [];
    const calls = [];
    const saves = [];
    let saved = null;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });

    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) {
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        assert(file.startsWith(root + path.sep), 'Resource must remain within checkout');
        // Auth is outside the renderer test. This fixture only serves the local
        // checkout and cannot grant access to any actual Hommy session.
        if (url.pathname === '/homeeasy-page-guard.js') {
          return route.fulfill({ contentType: 'application/javascript', body: '/* local PDF QA only */' });
        }
        assert(fs.existsSync(file), 'Missing local asset: ' + url.pathname);
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
        return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
      if (url.hostname === 'script.google.com') {
        assert.equal(request.method(), 'POST', 'Account workflow uses POST');
        const payload = request.postDataJSON();
        calls.push({ tipo: payload.tipo, requestId: payload.requestId });
        let response;
        switch (payload.tipo) {
          case 'GET_DOCUMENTOS_SEGURA': response = center; break;
          case 'LISTAR_CUENTAS_COBRO':
            response = { status: 'ok', cuentas: saved ? [{ id: 'QA', ...saved, url: 'https://example.invalid/cuenta-qa.pdf' }] : [] };
            break;
          case 'LISTAR_PAQUETES_DOCUMENTALES': response = { status: 'ok', paquetes: [] }; break;
          case 'PREPARAR_CUENTA_COBRO':
            response = {
              ...center, numeroCuenta: 'CC-2026-999',
              origen: payload.modo === 'OP' ? {
                nombre: 'CLIENTE QA', cedula: '000000', descripcion: 'Persiana de prueba',
                numeroOp: '999', estado: 'PENDIENTE', total: 2900000, saldo: 1450000
              } : null
            };
            break;
          case 'GUARDAR_CUENTA_COBRO':
            saves.push(payload);
            saved = { numeroCuenta: payload.numeroCuenta, cliente: payload.cliente, concepto: payload.concepto, valor: payload.valor, numeroOp: payload.numeroOp };
            response = { status: 'success', numeroCuenta: payload.numeroCuenta, nombreArchivo: 'CUENTA_QA.pdf', idCuenta: 'QA' };
            break;
          default: throw new Error('Unexpected backend action: ' + payload.tipo);
        }
        return route.fulfill({ json: response, headers: { 'access-control-allow-origin': '*' } });
      }
      if (url.pathname.endsWith('/html2canvas.min.js')) {
        return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(require.resolve('html2canvas/dist/html2canvas.min.js')) });
      }
      if (url.pathname.endsWith('/jspdf.umd.min.js')) {
        return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js')) });
      }
      if (url.pathname.endsWith('/all.min.css')) {
        return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(require.resolve('@fortawesome/fontawesome-free/css/all.min.css')) });
      }
      if (url.pathname.includes('/webfonts/')) {
        const font = path.join(path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json')), 'webfonts', path.basename(url.pathname));
        assert(fs.existsSync(font), 'Missing FontAwesome font');
        return route.fulfill({ contentType: url.pathname.endsWith('.woff2') ? 'font/woff2' : 'font/ttf', body: fs.readFileSync(font) });
      }
      throw new Error('Blocked unexpected external resource: ' + url.href);
    });

    await page.goto(origin + '/documentos.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('loading').classList.contains('show'));
    await page.evaluate(() => {
      if (typeof window.html2canvas !== 'function' || typeof window.jspdf?.jsPDF !== 'function') throw new Error('Real PDF libraries not loaded');
      const render = window.html2canvas;
      // Observe the real canvas returned by the real renderer, without changing
      // its options or its pixels. This catches the ancestor-transform bug.
      window.html2canvas = async (...args) => {
        const canvas = await render(...args);
        window.__QA_PDF_CAPTURE = { width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png') };
        return canvas;
      };
    });
    if (scenario.mode === 'MANUAL') {
      await page.locator('[data-mode="MANUAL"]').click();
      await page.locator('#clientInput').fill('CLIENTE QA');
      await page.locator('#docInput').fill('000000');
      await page.locator('#conceptInput').fill('Cuenta de cobro de prueba');
      await page.locator('#amountInput').fill('2.900.000');
    } else {
      await page.locator('#opInput').fill('999');
      await page.locator('#loadOpBtn').click();
      await page.waitForFunction(() => document.getElementById('clientInput').value === 'CLIENTE QA');
    }
    await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(output, scenario.name + '-before.png'), fullPage: true });
    const before = await page.evaluate(() => ({
      sheet: document.getElementById('pdfSheet').outerHTML,
      transform: document.getElementById('paperScale').style.transform,
      height: document.getElementById('paperScale').style.height
    }));
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#generateBtn').click();
    const download = await downloadPromise;
    await page.waitForFunction(() => !document.getElementById('loading').classList.contains('show'));
    const pdfPath = path.join(output, scenario.name + '.pdf');
    await download.saveAs(pdfPath);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, scenario.name + '-generated.png'), fullPage: true });
    const after = await page.evaluate(() => ({
      sheet: document.getElementById('pdfSheet').outerHTML,
      transform: document.getElementById('paperScale').style.transform,
      height: document.getElementById('paperScale').style.height,
      downloadEnabled: !document.getElementById('downloadBtn').disabled,
      shareEnabled: !document.getElementById('shareBtn').disabled,
      captured: window.__QA_PDF_CAPTURE
    }));
    assert.deepEqual(alerts, [], scenario.name + ': unexpected alert');
    assert.deepEqual(errors, [], scenario.name + ': unexpected browser error');
    assert.equal(saves.length, 1, 'Exactly one save per click');
    assert.equal(saves[0].valor, scenario.amount, 'Amount must stay unchanged');
    assert.equal(saves[0].numeroCuenta, 'CC-2026-999', 'Prepared account number must be preserved');
    assert.equal(saves[0].numeroOp, scenario.mode === 'OP' ? '999' : '', 'Source order must be preserved');
    assert.equal(calls.filter(item => item.tipo === 'PREPARAR_CUENTA_COBRO').at(-1).requestId, saves[0].requestId, 'Prepare and save share their request ID');
    assert.deepEqual({ sheet: after.sheet, transform: after.transform, height: after.height }, before, 'Live preview must remain intact');
    assert(after.downloadEnabled && after.shareEnabled, 'Existing download and share actions stay available');
    const pdf = fs.readFileSync(pdfPath);
    assert(pdf.subarray(0, 8).toString().startsWith('%PDF-1.'), 'Downloaded result must be a real PDF');
    assert.deepEqual(Buffer.from(saves[0].pdfBase64, 'base64'), pdf, 'Saved PDF must equal downloaded PDF');
    const png = Buffer.from(after.captured.png.split(',')[1], 'base64');
    fs.writeFileSync(path.join(output, scenario.name + '-capture.png'), png);
    const hash = createHash('sha256').update(png).digest('hex');
    rasterHashes.set(scenario.name, hash);
    report.scenarios.push({
      scenario: scenario.name, savedAmount: saves[0].valor, saves: saves.length,
      pdfBytes: pdf.length, canvas: { width: after.captured.width, height: after.captured.height },
      rasterSHA256: hash, previewUnchanged: true, previewTransform: after.transform,
      alerts, errors, actions: calls.map(item => item.tipo)
    });
    await page.close();
  }
  for (const mode of ['manual', 'op']) {
    assert.equal(rasterHashes.get('mobile-' + mode), rasterHashes.get('desktop-' + mode), mode + ': mobile PDF pixels must match desktop, independent of preview scale');
  }
  report.result = 'PASS';
  console.log('Cuenta de cobro PDF PASS: manual/OP, desktop/mobile, real rendering, preview preserved, amounts and requests unchanged.');
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message;
  throw error;
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
