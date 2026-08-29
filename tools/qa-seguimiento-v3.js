const { chromium } = require('playwright');

const daysAgo = n => {
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate()-n);
  return d.toISOString();
};

const cotizaciones = [
  {numero:'201',nombre:'Laura Gómez',estado:'COTIZACION',total:2450000,notas_seguimiento:'Confirmar tela y programar llamada de cierre.',url:'https://drive.google.com/file/d/abc/view?usp=drivesdk',fecha:daysAgo(2)},
  {numero:'202',nombre:'Carlos Pérez',estado:'COTIZACION',total:1800000,notas_seguimiento:'',url:'https://drive.google.com/file/d/def/view',fecha:daysAgo(10)},
  {numero:'203',nombre:'Ana Martínez',estado:'COTIZACION',total:3250000,notas_seguimiento:'Cliente pidió unos días para revisar la propuesta.',url:'',fecha:daysAgo(20)}
];

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:430,height:932},deviceScaleFactor:2,locale:'es-CO'});

  await page.route('**/homeeasy-page-guard.js*', r => r.fulfill({status:200,contentType:'application/javascript',body:'window.HomeEasyPageGuard={ready:Promise.resolve(true)};'}));
  await page.route('**/homeeasy-core.js*', r => r.fulfill({status:200,contentType:'application/javascript',body:'window.HomeEasyCore={};'}));
  await page.route('**/script.google.com/**', r => {
    if (r.request().method() === 'POST') {
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'success'})});
    }
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ok',cotizaciones})});
  });

  await page.goto('http://127.0.0.1:4173/seguimiento.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('loader')).display==='none');
  await page.waitForTimeout(200);

  const mobile = await page.evaluate(()=>{
    const first = document.querySelector('.crm-card').getBoundingClientRect();
    const filter = document.getElementById('filtersCard').getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      firstTop: first.top,
      filterH: filter.height,
      legend: getComputedStyle(document.querySelector('.age-legend')).display,
      heroP: getComputedStyle(document.querySelector('.hero p')).display,
      summaryH: document.querySelector('.summary-grid').getBoundingClientRect().height,
      actions: [...document.querySelectorAll('.crm-card:first-child .btn-crm span')].map(x=>x.textContent.trim()),
      period: document.getElementById('periodMobileLabel').textContent.trim(),
      count: document.getElementById('kpi-count').textContent.trim(),
      cards: document.querySelectorAll('.crm-card').length
    };
  });
  console.log('MOBILE_V3', mobile);
  if (mobile.overflow) throw new Error('horizontal overflow');
  if (mobile.firstTop > 390) throw new Error('first quotation still too low: '+mobile.firstTop);
  if (mobile.filterH > 70) throw new Error('collapsed period too tall: '+mobile.filterH);
  if (mobile.summaryH > 90) throw new Error('mobile KPIs too tall');
  if (mobile.legend !== 'none' || mobile.heroP !== 'none') throw new Error('mobile preamble not compacted');
  if (mobile.actions[0] !== 'Ver cotización') throw new Error('primary action hierarchy missing');
  if (mobile.period !== 'Este mes') throw new Error('mobile period label incorrect');
  if (mobile.count !== '3' || mobile.cards !== 3) throw new Error('quotation data regression');
  await page.screenshot({path:'seguimiento-mobile-v3.png',fullPage:true});

  await page.locator('#periodSummary').click();
  if (!(await page.locator('#filtersCard').evaluate(el=>el.classList.contains('open')))) throw new Error('period accordion did not open');
  await page.locator('#fecha-desde').fill('2026-08-10');
  await page.locator('#fecha-hasta').fill('2026-08-29');
  await page.locator('.btn-filter').click();
  await page.waitForTimeout(80);
  const custom = (await page.locator('#periodMobileLabel').textContent()).trim();
  if (custom !== 'Periodo personalizado') throw new Error('custom period summary missing');

  await page.setViewportSize({width:1440,height:950});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('loader')).display==='none');
  const desktop = await page.evaluate(()=>({
    cards: document.querySelectorAll('.crm-card').length,
    periodSummary: getComputedStyle(document.getElementById('periodSummary')).display,
    legend: getComputedStyle(document.querySelector('.age-legend')).display,
    actions: [...document.querySelectorAll('.crm-card:first-child .btn-crm span')].map(x=>x.textContent.trim()),
    overflow: document.documentElement.scrollWidth > innerWidth + 1
  }));
  console.log('DESKTOP_V3', desktop);
  if (desktop.cards !== 3 || desktop.periodSummary !== 'none' || desktop.legend === 'none' || desktop.overflow) throw new Error('desktop regression');
  if (desktop.actions[0] !== 'Ver cotización') throw new Error('desktop action hierarchy missing');
  await page.screenshot({path:'seguimiento-desktop-v3.png',fullPage:true});

  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
