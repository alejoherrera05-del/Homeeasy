const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  return out.sort();
}

function htmlRefs(file) {
  const source = fs.readFileSync(file, 'utf8');
  const refs = [];
  const re = /["'`](?!https?:|\/\/|data:|mailto:|tel:)([^"'`?#]*\.html)(?:[?#][^"'`]*)?["'`]/gi;
  let match;
  while ((match = re.exec(source))) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    if (!target.startsWith('../')) refs.push(target);
  }
  return refs;
}

function productionClosure() {
  const seen = new Set(['index.html', 'login.html', 'activar-cuenta.html']);
  const queue = [...seen];
  while (queue.length) {
    const file = queue.shift();
    if (!fs.existsSync(file)) continue;
    for (const ref of htmlRefs(file)) {
      if (fs.existsSync(ref) && !seen.has(ref)) {
        seen.add(ref);
        queue.push(ref);
      }
    }
  }
  return seen;
}

const oldConfig = {
  status: 'ok', version: 7, actualizadoEn: '2026-08-29T12:00:00-05:00',
  configuracion: {
    sistema: { version_app: '2.0', version_configuracion: 7 },
    empresa: { nombre_comercial: 'HOMEEASY POPAYÁN' },
    documentos: {
      pie_principal: 'HomeEasy - Viste tu hogar con estilo',
      pie_sistema: 'Documento generado automáticamente • Sistema Hommy V2.0',
      cotizacion: { titulo: 'COTIZACIÓN', validez_dias: 15 },
      pedido: { titulo: 'ORDEN DE PEDIDO', garantia_anios: 3, entrega_dias_habiles: 10 },
      recibo: { titulo: 'RECIBO DE ABONO' }
    }
  }
};
const generic = { status: 'ok', success: true, eventos: [], cotizaciones: [], ordenes: [], abonos: [], clientes: [], resultados: [], referencias: [], data: [] };
const rawIconRe = /\b(?:calendar_month|event_upcoming|chevron_left|chevron_right|arrow_back|upcoming)\b/i;
const oldPublicVersionRe = /(?:VERSI[ÓO]N\s*2\.0|Sistema\s+Hommy\s+V?2\.0|HomeEasy\s+V?2\.0)/i;

(async () => {
  const files = walk('.');
  const production = productionClosure();
  console.log('FINAL_HTML_COUNT=' + files.length);
  console.log('FINAL_PRODUCTION_COUNT=' + production.size);
  const browser = await chromium.launch({ headless: true });
  const results = [];

  async function test(file, viewport, mode) {
    const context = await browser.newContext({ viewport, locale: 'es-CO' });
    const page = await context.newPage();
    const pageErrors = [];
    const localFailures = [];
    const localHttp = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    page.on('requestfailed', req => {
      try { const u = new URL(req.url()); if (u.hostname === '127.0.0.1') localFailures.push(u.pathname + ': ' + (req.failure()?.errorText || 'failed')); } catch {}
    });
    page.on('response', res => {
      try { const u = new URL(res.url()); if (u.hostname === '127.0.0.1' && res.status() >= 400) localHttp.push(u.pathname + ': ' + res.status()); } catch {}
    });
    await page.route('**/homeeasy-page-guard.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route('**/script.google.com/**', r => {
      let payload = generic;
      try { const u = new URL(r.request().url()); if (u.searchParams.get('tipo') === 'GET_CONFIGURACION') payload = oldConfig; } catch {}
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.route('**/script.googleusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generic) }));

    let navError = null;
    try {
      await page.goto('http://127.0.0.1:4173/' + file + '?final_v3_qa=1', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(550);
    } catch (e) { navError = String(e.message || e).split('\n')[0]; }

    let state = {};
    if (!navError) {
      state = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').trim();
        const localImgs = [...document.images].filter(img => {
          const src = img.getAttribute('src') || '';
          return src && !/^(https?:|\/\/|data:|blob:)/i.test(src);
        });
        return {
          bodyText,
          title: document.title,
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
          brokenImages: localImgs.filter(img => img.complete && img.naturalWidth === 0).map(img => img.getAttribute('src')),
          finalPath: location.pathname.split('/').pop()
        };
      });
    }
    const result = {
      file, mode, navError,
      pageErrors: [...new Set(pageErrors)],
      localFailures: [...new Set(localFailures)],
      localHttp: [...new Set(localHttp)],
      rawIcon: state.bodyText ? rawIconRe.test(state.bodyText) : false,
      oldPublicVersion: state.bodyText ? oldPublicVersionRe.test(state.bodyText) : false,
      overflow: !!state.overflow,
      brokenImages: state.brokenImages || [],
      title: state.title || '', finalPath: state.finalPath || ''
    };
    results.push(result);
    await context.close();
    return result;
  }

  for (const file of files) {
    const r = await test(file, { width: 430, height: 932 }, 'mobile');
    const problems = [];
    if (r.navError) problems.push('NAV=' + r.navError);
    if (r.pageErrors.length) problems.push('JS=' + r.pageErrors.join(' | '));
    if (r.localFailures.length) problems.push('LOCAL_FAIL=' + r.localFailures.join(' | '));
    if (r.localHttp.length) problems.push('LOCAL_HTTP=' + r.localHttp.join(' | '));
    if (r.rawIcon) problems.push('RAW_ICON_TEXT');
    if (r.oldPublicVersion) problems.push('OLD_PUBLIC_VERSION');
    if (r.brokenImages.length) problems.push('BROKEN_IMAGE=' + r.brokenImages.join(','));
    if (production.has(file) && r.overflow) problems.push('H_OVERFLOW');
    console.log((problems.length ? 'FINAL_ISSUE ' : 'FINAL_OK ') + file + (problems.length ? ' | ' + problems.join(' ; ') : ''));
  }

  for (const file of [...production].sort()) {
    if (fs.existsSync(file)) await test(file, { width: 1440, height: 1000 }, 'desktop-production');
  }

  const blockers = results.filter(r => production.has(r.file) && (r.navError || r.pageErrors.length || r.localFailures.length || r.localHttp.length || r.rawIcon || r.oldPublicVersion || r.brokenImages.length || (r.mode === 'mobile' && r.overflow)));
  fs.writeFileSync('final-v3-html-audit.json', JSON.stringify({ files, production: [...production].sort(), results, blockers }, null, 2));
  console.log('FINAL_PRODUCTION_BLOCKERS=' + blockers.length);
  blockers.forEach(r => console.log('FINAL_BLOCKER', JSON.stringify(r)));
  await browser.close();
  if (files.length !== 29) throw new Error('Expected 29 repository HTML files, got ' + files.length);
  if (blockers.length) process.exit(2);
})().catch(err => { console.error(err); process.exit(1); });
