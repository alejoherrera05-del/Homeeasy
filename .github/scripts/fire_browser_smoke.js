const { chromium, devices } = require('playwright');
const fs = require('fs');

const BASE = process.env.HOMEEASY_BASE || 'https://alejoherrera05-del.github.io/Homeeasy/';
const report = { status:'ok', errors:[], warnings:[], timings:{}, pages:{} };
const fail = msg => { report.errors.push(msg); report.status='error'; };
const warn = msg => report.warnings.push(msg);

function fakeSession(){
  return {
    version:2,persistence:'session',localId:'qa-owner-uid',email:'qa@homeeasy.local',displayName:'QA Owner',
    idToken:'qa.fake.token',refreshToken:'qa-refresh',expiresAt:Date.now()+60*60*1000,
    appSessionToken:'qa-app-session',appSessionExpiresAt:new Date(Date.now()+4*60*60*1000).toISOString(),
    appSessionValidatedAt:Date.now(),
    profile:{uid:'qa-owner-uid',nombre:'QA Owner',email:'qa@homeeasy.local',rol:'PROPIETARIO',estado:'ACTIVO',emailVerificado:true,ultimoAcceso:new Date().toISOString(),ultimoDispositivo:'QA'},
    permissions:['app.access','clientes.read','clientes.write','ventas.read','cotizaciones.read','cotizaciones.write','pedidos.read','pedidos.write','abonos.read','abonos.write','caja.read','caja.write','documentos.read','documentos.write','agenda.read','agenda.write','reportes.read','config.read','config.write','perfil.read','usuarios.read','usuarios.write','roles.read','roles.write'],
    savedAt:Date.now()
  };
}

async function mockBackend(context){
  await context.route('https://script.google.com/**', async route => {
    const req=route.request();
    let payload={};
    try { payload=JSON.parse(req.postData()||'{}'); } catch {}
    const url=new URL(req.url());
    const tipo=payload.tipo || url.searchParams.get('tipo') || '';
    let body={status:'ok'};
    if (tipo==='AUTH_VALIDAR_SESION' || tipo==='AUTH_ABRIR_SESION') body={status:'ok',valido:true,sessionToken:'qa-app-session',expiresAt:new Date(Date.now()+4*60*60*1000).toISOString(),perfil:fakeSession().profile,permisos:fakeSession().permissions};
    else if (tipo==='AUTH_PRESENCIA') body={status:'ok'};
    else if (tipo==='GET_CONFIGURACION') body={status:'ok',configuracion:{caja:{nombre:'Caja Principal'}}};
    else if (tipo==='VALIDAR_SESION_CAJA') body={status:'success',valido:false};
    else if (tipo==='EVENTOS_TODOS') body={status:'ok',eventos:[]};
    else if (url.searchParams.get('init')==='LOAD') body={status:'ok',clientes:[],ordenes:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

function observe(page, name){
  const bucket={consoleErrors:[],pageErrors:[],failedRequests:[]};
  report.pages[name]=bucket;
  page.on('console', msg => { if(msg.type()==='error') bucket.consoleErrors.push(msg.text()); });
  page.on('pageerror', err => bucket.pageErrors.push(String(err)));
  page.on('requestfailed', req => {
    const u=req.url();
    if(u.startsWith(BASE) || u.includes('script.google.com')) bucket.failedRequests.push(`${u} :: ${req.failure()?.errorText||''}`);
  });
  return bucket;
}

async function testLogin(browser){
  for (const cfg of [
    {name:'login-desktop',viewport:{width:2880,height:1920}},
    {name:'login-iphone',viewport:{width:390,height:844},isMobile:true,hasTouch:true}
  ]) {
    const context=await browser.newContext({viewport:cfg.viewport,isMobile:!!cfg.isMobile,hasTouch:!!cfg.hasTouch});
    const page=await context.newPage(); const obs=observe(page,cfg.name);
    const t=Date.now();
    const resp=await page.goto(BASE+'login.html',{waitUntil:'domcontentloaded',timeout:30000});
    report.timings[cfg.name]=Date.now()-t;
    if(!resp || resp.status()>=400) fail(`${cfg.name}: HTTP ${resp&&resp.status()}`);
    await page.waitForTimeout(800);
    if(!(await page.locator('#loginForm').count())) fail(`${cfg.name}: login form missing`);
    const overflow=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight}));
    if(overflow.sw>overflow.cw+2) fail(`${cfg.name}: horizontal overflow ${overflow.sw}/${overflow.cw}`);
    if(cfg.name==='login-desktop' && overflow.sh>overflow.ch+8) warn(`${cfg.name}: vertical scroll ${overflow.sh}/${overflow.ch}`);
    if(obs.pageErrors.length) fail(`${cfg.name}: page errors ${obs.pageErrors.join(' | ')}`);
    await context.close();
  }
}

async function testAR(browser){
  for (const cfg of [
    {name:'ar-desktop',viewport:{width:1440,height:1000}},
    {name:'ar-iphone',viewport:{width:390,height:844},isMobile:true,hasTouch:true}
  ]) {
    const context=await browser.newContext({viewport:cfg.viewport,isMobile:!!cfg.isMobile,hasTouch:!!cfg.hasTouch});
    const page=await context.newPage(); const obs=observe(page,cfg.name);
    const t=Date.now();
    const resp=await page.goto(BASE+'ar-homeeasy-v3.html',{waitUntil:'domcontentloaded',timeout:30000});
    report.timings[cfg.name]=Date.now()-t;
    if(!resp || resp.status()>=400) fail(`${cfg.name}: HTTP ${resp&&resp.status()}`);
    await page.waitForSelector('#viewer',{timeout:15000});
    await page.waitForTimeout(2200);
    for(const product of ['panel','onda','sheer']){
      await page.selectOption('#product',product);
      await page.waitForTimeout(650);
      const visible=await page.locator(`.product-panel[data-product="${product}"]`).isVisible();
      if(!visible) fail(`${cfg.name}: product panel ${product} not visible`);
    }
    const status=(await page.locator('#status').innerText()).toLowerCase();
    if(status.includes('error') || status.includes('no se pudo')) fail(`${cfg.name}: AR status error: ${status}`);
    if(obs.pageErrors.length) fail(`${cfg.name}: page errors ${obs.pageErrors.join(' | ')}`);
    if(obs.failedRequests.length) warn(`${cfg.name}: failed local requests ${obs.failedRequests.join(' | ')}`);
    await context.close();
  }
}

async function testAuthenticatedNavigation(browser){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mockBackend(context);
  await context.addInitScript(session => {
    sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1', JSON.stringify(session));
    sessionStorage.setItem('APP_INIT_DONE','true');
  }, fakeSession());
  const page=await context.newPage(); const obs=observe(page,'authenticated-navigation');
  let t=Date.now();
  await page.goto(BASE+'index.html',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(700);
  report.timings['index-auth-mock']=Date.now()-t;
  const curtainVisible=await page.locator('#intro-curtain').isVisible().catch(()=>false);
  if(curtainVisible) fail('index mock: intro curtain visible despite active session');
  const authPending=await page.evaluate(()=>document.documentElement.classList.contains('homeeasy-auth-pending'));
  if(authPending) fail('index mock: auth pending cover remained');

  const routes=['caja.html','clientes.html','ventas.html','documentos.html','calendario.html','configuracion.html'];
  for(const route of routes){
    await page.goto(BASE+'index.html',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(220);
    const link=page.locator(`a[href="${route}"]`).first();
    if(!(await link.count())) { warn(`nav: link ${route} not found on index`); continue; }
    await link.click();
    await page.waitForURL(new RegExp(route.replace('.','\\.')), {timeout:10000});
    await page.waitForTimeout(250);
    const start=Date.now();
    if(route==='caja.html'){
      await page.locator('#pin-screen button[aria-label="Volver"]').click();
    } else {
      const back=page.locator('a[href="index.html"]').first();
      if(await back.count()) await back.click();
      else await page.evaluate(()=>window.HomeEasyCore && HomeEasyCore.goHome());
    }
    await page.waitForURL(/index\.html/, {timeout:10000});
    const elapsed=Date.now()-start;
    report.timings[`return-${route}`]=elapsed;
    await page.waitForTimeout(120);
    const visible=await page.locator('#intro-curtain').isVisible().catch(()=>false);
    if(visible) fail(`return ${route}: intro curtain visible`);
    if(elapsed>1500) warn(`return ${route}: slow ${elapsed}ms`);
  }
  if(obs.pageErrors.length) fail(`authenticated nav: page errors ${obs.pageErrors.join(' | ')}`);
  await context.close();
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  try { await testLogin(browser); await testAR(browser); await testAuthenticatedNavigation(browser); }
  catch(e){ fail(`UNCAUGHT:${e.stack||e}`); }
  finally { await browser.close(); }
  fs.writeFileSync('FIRE_AUDIT_BROWSER.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  process.exit(report.errors.length?1:0);
})();
