const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.HOMEEASY_BASE || 'https://alejoherrera05-del.github.io/Homeeasy/';
const report = { status:'ok', errors:[], warnings:[], timings:{}, pages:{}, stress:{} };
const fail = msg => { report.errors.push(msg); report.status='error'; };
const warn = msg => report.warnings.push(msg);

function permissions(){ return ['app.access','clientes.read','clientes.write','ventas.read','cotizaciones.read','cotizaciones.write','pedidos.read','pedidos.write','abonos.read','abonos.write','caja.read','caja.write','documentos.read','documentos.write','agenda.read','agenda.write','reportes.read','config.read','config.write','perfil.read','usuarios.read','usuarios.write','roles.read','roles.write']; }
function profile(){ return {uid:'qa-owner-uid',nombre:'QA Owner',email:'qa@homeeasy.local',rol:'PROPIETARIO',estado:'ACTIVO',emailVerificado:true,ultimoAcceso:new Date().toISOString(),ultimoDispositivo:'QA'}; }
function fakeSession(){ return {version:2,persistence:'session',localId:'qa-owner-uid',email:'qa@homeeasy.local',displayName:'QA Owner',idToken:'qa.fake.token',refreshToken:'qa-refresh',expiresAt:Date.now()+3600000,appSessionToken:'qa-app-session',appSessionExpiresAt:new Date(Date.now()+14400000).toISOString(),appSessionValidatedAt:Date.now(),profile:profile(),permissions:permissions(),savedAt:Date.now()}; }

async function installAuthStub(context){
  await context.addInitScript(({session,perms,prof}) => {
    sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1', JSON.stringify(session));
    sessionStorage.setItem('APP_INIT_DONE','true');
    const auth={
      isConfigured:()=>true,getCachedHomeEasySession:()=>session,restoreHomeEasySession:async()=>session,
      getCurrentProfile:()=>prof,getCurrentUser:()=>({uid:prof.uid,email:prof.email,displayName:prof.nombre,persistence:'session',expiresAt:session.expiresAt}),
      getAppSessionToken:()=>session.appSessionToken,hasPermission:(p)=>prof.rol==='PROPIETARIO'||perms.includes(p),shouldRevalidateAppSession:()=>false,
      validateAppSession:async()=>({status:'ok',valido:true}),sendPresence:async()=>({status:'ok'}),startPresenceHeartbeat:()=>{},stopPresenceHeartbeat:()=>{},
      isTransientError:()=>false,redirectToLogin:()=>{},signOut:async()=>{},buildMeta:()=>({pagina:location.pathname.split('/').pop()||'index.html',versionApp:'QA'})
    };
    Object.defineProperty(window,'HomeEasyAuth',{value:auth,writable:true,configurable:true});
  }, {session:fakeSession(),perms:permissions(),prof:profile()});
}

async function mockBackend(context){
  await context.route('https://script.google.com/**', async route => {
    const req=route.request(); let payload={}; try{payload=JSON.parse(req.postData()||'{}')}catch{}
    const url=new URL(req.url()); const tipo=payload.tipo||url.searchParams.get('tipo')||'';
    let body={status:'ok'};
    if(tipo==='GET_CONFIGURACION') body={status:'ok',configuracion:{caja:{nombre:'Caja Principal'},empresa:{nombre:'HomeEasy'}}};
    else if(tipo==='VALIDAR_SESION_CAJA') body={status:'success',valido:false};
    else if(tipo==='EVENTOS_TODOS') body={status:'ok',eventos:[]};
    else if(tipo==='GET_CLIENTES' || tipo==='CLIENTES_LISTAR') body={status:'ok',clientes:[]};
    else if(tipo==='GET_VENTAS' || tipo==='VENTAS_LISTAR') body={status:'ok',ventas:[]};
    else if(tipo==='AUTH_LISTAR_USUARIOS') body={status:'ok',usuarios:[]};
    else if(tipo==='AUTH_LISTAR_ROLES_PERMISOS') body={status:'ok',roles:[]};
    else if(url.searchParams.get('init')==='LOAD') body={status:'ok',clientes:[],ordenes:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

function observe(page,name){
  const bucket={consoleErrors:[],pageErrors:[],failedRequests:[],httpErrors:[]}; report.pages[name]=bucket;
  page.on('console',m=>{if(m.type()==='error')bucket.consoleErrors.push(m.text())});
  page.on('pageerror',e=>bucket.pageErrors.push(String(e)));
  page.on('requestfailed',r=>{const u=r.url(); if(u.startsWith(BASE)||u.includes('script.google.com')) bucket.failedRequests.push(`${u} :: ${r.failure()?.errorText||''}`)});
  page.on('response',r=>{ if(r.status()>=400) bucket.httpErrors.push(`${r.status()} ${r.url()}`); });
  return bucket;
}

async function testLogin(browser){
  for(const cfg of [{name:'login-desktop',viewport:{width:2880,height:1920}},{name:'login-iphone',viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await browser.newContext({viewport:cfg.viewport,isMobile:!!cfg.isMobile,hasTouch:!!cfg.hasTouch}); const page=await context.newPage(); const obs=observe(page,cfg.name); const t=Date.now();
    const resp=await page.goto(BASE+'login.html',{waitUntil:'domcontentloaded',timeout:30000}); report.timings[cfg.name]=Date.now()-t; if(!resp||resp.status()>=400)fail(`${cfg.name}: HTTP ${resp&&resp.status()}`); await page.waitForTimeout(700);
    if(!(await page.locator('#loginForm').count()))fail(`${cfg.name}: login form missing`);
    const o=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight}));
    if(o.sw>o.cw+2)fail(`${cfg.name}: horizontal overflow ${o.sw}/${o.cw}`); if(cfg.name==='login-desktop'&&o.sh>o.ch+8)warn(`${cfg.name}: vertical scroll ${o.sh}/${o.ch}`);
    if(obs.pageErrors.length)fail(`${cfg.name}: ${obs.pageErrors.join(' | ')}`); if(obs.httpErrors.length)warn(`${cfg.name} HTTP: ${obs.httpErrors.join(' | ')}`); await context.close();
  }
}

async function testAR(browser){
  for(const cfg of [{name:'ar-desktop',viewport:{width:1440,height:1000}},{name:'ar-iphone',viewport:{width:390,height:844},isMobile:true,hasTouch:true}]){
    const context=await browser.newContext({viewport:cfg.viewport,isMobile:!!cfg.isMobile,hasTouch:!!cfg.hasTouch}); const page=await context.newPage(); const obs=observe(page,cfg.name); const t=Date.now();
    const resp=await page.goto(BASE+'ar-homeeasy-v3.html',{waitUntil:'domcontentloaded',timeout:30000}); report.timings[cfg.name]=Date.now()-t; if(!resp||resp.status()>=400)fail(`${cfg.name}: HTTP ${resp&&resp.status()}`); await page.waitForSelector('#viewer',{timeout:15000}); await page.waitForTimeout(1600);
    let switches=0; for(let c=0;c<6;c++){for(const product of ['panel','onda','sheer']){await page.selectOption('#product',product); await page.waitForTimeout(250); switches++; if(!(await page.locator(`.product-panel[data-product="${product}"]`).isVisible()))fail(`${cfg.name}: ${product} hidden`)}}
    report.stress[`${cfg.name}-product-switches`]=switches;
    for(const [sel,val] of [['#sheer-width','1.75'],['#sheer-height','2.35'],['#sheer-width','2.15'],['#sheer-height','1.90']]){await page.locator(sel).fill(val); await page.locator(sel).dispatchEvent('change'); await page.waitForTimeout(250)}
    const st=((await page.locator('.controls-card #status').first().innerText().catch(()=>''))||'').toLowerCase(); if(st.includes('error')||st.includes('no se pudo'))fail(`${cfg.name}: AR status ${st}`);
    if(obs.pageErrors.length)fail(`${cfg.name}: ${obs.pageErrors.join(' | ')}`); if(obs.failedRequests.length)warn(`${cfg.name}: ${obs.failedRequests.join(' | ')}`); if(obs.httpErrors.length)warn(`${cfg.name} HTTP: ${obs.httpErrors.join(' | ')}`); await context.close();
  }
}

async function assertHomeReady(page,label){
  await page.waitForURL(/index\.html/,{timeout:10000}); await page.waitForTimeout(90);
  if(await page.locator('#intro-curtain').isVisible().catch(()=>false))fail(`${label}: intro curtain visible`);
  if(await page.evaluate(()=>document.documentElement.classList.contains('homeeasy-auth-pending')))fail(`${label}: auth pending visible`);
}

async function openRoute(page,route){
  await page.goto(BASE+'index.html',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(150); await assertHomeReady(page,`pre-${route}`);
  let link=page.locator(`a[href="${route}"]:visible`).first();
  if(await link.count()) { await link.click(); }
  else { await page.goto(BASE+route,{waitUntil:'domcontentloaded'}); }
  await page.waitForURL(new RegExp(route.replace('.','\\.')),{timeout:10000}); await page.waitForTimeout(160);
}

async function returnHome(page,route){
  const s=Date.now();
  if(route==='caja.html') await page.locator('#pin-screen button[aria-label="Volver"]').click();
  else {
    const back=page.locator('a[href="index.html"]:visible').first();
    if(await back.count()) await back.click(); else await page.evaluate(()=>window.HomeEasyCore && HomeEasyCore.goHome());
  }
  await assertHomeReady(page,`return ${route}`); return Date.now()-s;
}

async function testAuthenticatedNavigation(browser){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); await mockBackend(context); await installAuthStub(context); const page=await context.newPage(); const obs=observe(page,'authenticated-navigation');
  const t=Date.now(); await page.goto(BASE+'index.html',{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(450); report.timings['index-auth-stub']=Date.now()-t; await assertHomeReady(page,'index stub');
  const routes=['caja.html','clientes.html','ventas.html','documentos.html','calendario.html','configuracion.html','cotizacion.html','seguimiento.html','pedido.html','abono.html','reportes.html','perfil.html'];
  for(const route of routes){
    await openRoute(page,route); const elapsed=await returnHome(page,route); report.timings[`return-${route}`]=elapsed; if(elapsed>1500)warn(`return ${route}: ${elapsed}ms`);
  }
  let maxReturn=0, total=0;
  for(let i=0;i<20;i++){
    await openRoute(page,'caja.html'); const elapsed=await returnHome(page,'caja.html'); maxReturn=Math.max(maxReturn,elapsed); total+=elapsed;
  }
  report.stress['caja-return-cycles']=20; report.stress['caja-max-return-ms']=maxReturn; report.stress['caja-avg-return-ms']=Math.round(total/20); if(maxReturn>1500)warn(`caja stress max ${maxReturn}ms`);
  if(obs.pageErrors.length)fail(`authenticated nav: ${obs.pageErrors.join(' | ')}`);
  const uniqueHttp=[...new Set(obs.httpErrors)]; if(uniqueHttp.length)warn(`authenticated nav HTTP errors: ${uniqueHttp.join(' | ')}`);
  await context.close();
}

(async()=>{const browser=await chromium.launch({headless:true}); try{await testLogin(browser);await testAR(browser);await testAuthenticatedNavigation(browser)}catch(e){fail(`UNCAUGHT:${e.stack||e}`)}finally{await browser.close()} fs.writeFileSync('FIRE_AUDIT_BROWSER.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)); process.exit(report.errors.length?1:0)})();
