import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const server=spawn('python3',['-m','http.server','8090','--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(r=>setTimeout(r,900));
const base='http://127.0.0.1:8090/';
const permissions=['app.access','clientes.read','clientes.write','cotizaciones.read','cotizaciones.write','pedidos.read','pedidos.write','abonos.read','abonos.write','caja.read','caja.write','agenda.read','agenda.write','ventas.read','reportes.read','documentos.read','documentos.write','config.read','config.write','usuarios.read','usuarios.write','roles.read','roles.write','perfil.read','perfil.write','admin.audit','admin.security','system.manage','invitaciones.write'];
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken=`${b64({alg:'none',typ:'JWT'})}.${b64({aud:'homeeasy-auth',iss:'https://securetoken.google.com/homeeasy-auth',user_id:'audit-owner',sub:'audit-owner',email:'audit@example.com',email_verified:true,exp:Math.floor(Date.now()/1000)+3600})}.x`;
const session=({stale=false,perms=permissions,role='PROPIETARIO'}={})=>({version:2,persistence:'session',localId:'audit-owner',email:'audit@example.com',displayName:'Audit Owner',idToken,refreshToken:'audit-refresh',expiresAt:Date.now()+3600_000,appSessionToken:'audit-app-token',appSessionExpiresAt:new Date(Date.now()+4*3600_000).toISOString(),appSessionValidatedAt:Date.now()-(stale?10*60_000:0),profile:{uid:'audit-owner',nombre:'Audit Owner',email:'audit@example.com',rol:role,estado:'ACTIVO',emailVerificado:true},permissions:perms,savedAt:Date.now()});

function requestType(req){
  let tipo=''; try{ const d=JSON.parse(req.postData()||'{}'); tipo=d.tipo||'';}catch{}
  try{const u=new URL(req.url()); tipo=tipo||u.searchParams.get('tipo')||'';}catch{}
  return tipo;
}
function mockData(req,perms=permissions){
  const tipo=requestType(req); const u=new URL(req.url());
  if(u.searchParams.get('init')) return {status:'ok',clientes:[[]],ordenes:[[]]};
  if(tipo==='EVENTOS_TODOS') return {status:'ok',eventos:[]};
  if(tipo==='GET_CONFIGURACION') return {status:'ok',configuracion:{empresa:{nombre:'HomeEasy'},caja:{nombre:'Caja Principal'},documentos:{}}};
  if(tipo==='AUTH_VALIDAR_SESION') return {status:'success',valido:true,perfil:{uid:'audit-owner',nombre:'Audit Owner',email:'audit@example.com',rol:'PROPIETARIO',estado:'ACTIVO'},permisos:perms,expiresAt:new Date(Date.now()+4*3600_000).toISOString()};
  if(tipo==='AUTH_PRESENCIA') return {status:'ok'};
  return {status:'ok',valido:true,data:[],clientes:[],ordenes:[],eventos:[],cotizaciones:[],ventas:[],feed:[],saldo:0,entradasMes:0,salidasMes:0,configuracion:{empresa:{nombre:'HomeEasy'},caja:{nombre:'Caja Principal'},documentos:{}}};
}

const browser=await chromium.launch({headless:true});
let failures=[]; let notes=[];
async function makePage({stale=false,backendMode='ok',perms=permissions,role='PROPIETARIO',width=1280,height=800}={}){
  const context=await browser.newContext({viewport:{width,height}});
  await context.addInitScript(({s})=>{sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1',JSON.stringify(s));sessionStorage.setItem('APP_INIT_DONE','true');},{s:session({stale,perms,role})});
  const page=await context.newPage();
  const pageErrors=[]; const consoleErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') consoleErrors.push(m.text())});
  await page.route('https://script.google.com/**',async route=>{
    if(backendMode==='network') return route.abort('internetdisconnected');
    if(backendMode==='revoked' && requestType(route.request())==='AUTH_VALIDAR_SESION') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'error',valido:false,code:'APP_SESSION_REVOKED',msg:'Sesión revocada por QA'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mockData(route.request(),perms))});
  });
  await page.route('https://homeeasy-l5n1.onrender.com/**',r=>r.fulfill({status:204,body:''}));
  return {context,page,pageErrors,consoleErrors};
}
async function check(name,fn){ try{await fn();console.log('PASS',name);}catch(e){failures.push(`${name}: ${e.message}`);console.log('FAIL',name,e.message);} }

await check('login exact 2880x1920 fits without desktop scroll',async()=>{const {context,page,pageErrors}=await makePage({width:2880,height:1920}); await page.goto(base+'login.html'); await page.waitForTimeout(350); const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight})); if(m.sw>m.cw+2) throw Error(`horizontal overflow ${m.sw}/${m.cw}`); if(m.sh>m.ch+2) throw Error(`vertical overflow ${m.sh}/${m.ch}`); if(pageErrors.length) throw Error(pageErrors.join(' | ')); await context.close();});
await check('login desktop fits viewport',async()=>{const {context,page,pageErrors}=await makePage({width:1440,height:900}); await page.goto(base+'login.html'); await page.waitForTimeout(300); const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})); if(m.sw>m.cw+2) throw Error(`horizontal overflow ${m.sw}/${m.cw}`); if(pageErrors.length) throw Error(pageErrors.join(' | ')); await context.close();});
await check('login mobile fits viewport',async()=>{const {context,page}=await makePage({width:390,height:844}); await page.goto(base+'login.html'); await page.waitForTimeout(250); const o=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2); if(o) throw Error('horizontal overflow'); await context.close();});

await check('index cached session opens without curtain',async()=>{const {context,page,pageErrors}=await makePage(); await page.goto(base+'index.html'); await page.waitForTimeout(500); const state=await page.evaluate(()=>({curtain:getComputedStyle(document.querySelector('#intro-curtain')).display,loading:document.documentElement.classList.contains('homeeasy-auth-pending'),nav:!!document.querySelector('.nav-groups')})); if(!state.nav||state.curtain!=='none'||state.loading) throw Error(JSON.stringify(state)); if(pageErrors.length) throw Error(pageErrors.join(' | ')); await context.close();});

await check('Index survives 3 reloads without replaying intro',async()=>{const {context,page}=await makePage(); await page.goto(base+'index.html'); for(let i=0;i<3;i++){await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(250); const s=await page.evaluate(()=>({curtain:getComputedStyle(document.querySelector('#intro-curtain')).display,pending:document.documentElement.classList.contains('homeeasy-auth-pending')})); if(s.curtain!=='none'||s.pending) throw Error(`reload ${i+1}: ${JSON.stringify(s)}`);} await context.close();});

await check('Index -> Caja -> back is instant and no intro',async()=>{const {context,page}=await makePage({width:390,height:844}); await page.goto(base+'index.html'); await page.waitForTimeout(350); await page.click('a[href="caja.html"]'); await page.waitForURL('**/caja.html'); await page.waitForTimeout(250); const start=Date.now(); await page.click('#pin-screen .fn-key'); await page.waitForURL('**/index.html',{timeout:2500}); await page.waitForSelector('.nav-groups',{timeout:1500}); const elapsed=Date.now()-start; const curtain=await page.evaluate(()=>getComputedStyle(document.querySelector('#intro-curtain')).display); if(elapsed>1500) throw Error(`return took ${elapsed}ms`); if(curtain!=='none') throw Error(`curtain=${curtain}`); notes.push(`Caja return ${elapsed}ms`); await context.close();});

await check('8 repeated Index/Caja returns stay stable',async()=>{const {context,page}=await makePage({width:390,height:844}); await page.goto(base+'index.html'); await page.waitForTimeout(300); let max=0; for(let i=0;i<8;i++){await page.click('a[href="caja.html"]'); await page.waitForURL('**/caja.html'); const start=Date.now(); await page.click('#pin-screen .fn-key'); await page.waitForURL('**/index.html',{timeout:2500}); await page.waitForSelector('.nav-groups'); max=Math.max(max,Date.now()-start); const c=await page.evaluate(()=>getComputedStyle(document.querySelector('#intro-curtain')).display); if(c!=='none') throw Error(`intro replayed on cycle ${i+1}`);} notes.push(`8-cycle max return ${max}ms`); if(max>1500) throw Error(`slow max return ${max}ms`); await context.close();});

for(const mod of ['clientes.html','ventas.html','cotizacion.html','seguimiento.html','pedido.html','abono.html','caja.html','documentos.html','calendario.html','reportes.html','configuracion.html','perfil.html','Hommychat.html','asistente.html']){
  await check(`guard authorizes ${mod}`,async()=>{const {context,page,pageErrors}=await makePage(); await page.goto(base+mod,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(650); const st=await page.evaluate(()=>window.HomeEasyPageGuard?window.HomeEasyPageGuard.getStatus():'missing'); if(st!=='authorized') throw Error(`guard=${st}, url=${page.url()}`); if(pageErrors.length) throw Error(`page errors: ${pageErrors.join(' | ')}`); await context.close();});
}

await check('limited role is denied Caja without losing session',async()=>{const limited=['app.access','clientes.read']; const {context,page}=await makePage({perms:limited,role:'CONSULTA'}); await page.goto(base+'caja.html',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(550); const state=await page.evaluate(()=>({guard:window.HomeEasyPageGuard&&window.HomeEasyPageGuard.getStatus(),denied:!!document.querySelector('#homeeasyAccessDenied'),url:location.pathname,token:!!sessionStorage.getItem('HOMEEASY_AUTH_SESSION_V1')})); if(state.guard!=='denied'||!state.denied||!state.token||!state.url.endsWith('/caja.html')) throw Error(JSON.stringify(state)); await context.close();});

await check('unauthenticated protected page redirects to login',async()=>{const context=await browser.newContext(); const page=await context.newPage(); await page.goto(base+'clientes.html',{waitUntil:'domcontentloaded'}); await page.waitForURL('**/login.html?**',{timeout:3500}); await context.close();});

await check('temporary backend outage behavior on Index',async()=>{const {context,page}=await makePage({stale:true,backendMode:'network'}); await page.goto(base+'index.html',{waitUntil:'domcontentloaded',timeout:5000}).catch(()=>{}); await page.waitForTimeout(1800); const state={url:page.url(),nav:await page.locator('.nav-groups').count(),pending:await page.evaluate(()=>document.documentElement.classList.contains('homeeasy-auth-pending')).catch(()=>null)}; notes.push(`Index outage: ${JSON.stringify(state)}`); if(state.url.includes('login.html')) throw Error('redirected to login on transient network failure'); if(!state.nav) throw Error('Index became unavailable on transient network failure'); await context.close();});

await check('temporary backend outage behavior on module',async()=>{const {context,page}=await makePage({stale:true,backendMode:'network'}); await page.goto(base+'clientes.html',{waitUntil:'domcontentloaded',timeout:5000}).catch(()=>{}); await page.waitForTimeout(1800); const state={url:page.url(),guard:await page.evaluate(()=>window.HomeEasyPageGuard?window.HomeEasyPageGuard.getStatus():'missing').catch(()=> 'gone')}; notes.push(`Module outage: ${JSON.stringify(state)}`); if(state.url.includes('login.html')) throw Error('redirected to login on transient network failure'); if(state.guard!=='authorized') throw Error(`guard became ${state.guard}`); await context.close();});

await check('definitive session revocation stays on login and removes app session',async()=>{const {context,page}=await makePage({stale:true,backendMode:'revoked'}); await page.goto(base+'clientes.html',{waitUntil:'domcontentloaded'}); await page.waitForURL(url=>url.pathname.endsWith('/login.html'),{timeout:3500,waitUntil:'domcontentloaded'}); await page.waitForTimeout(900); if(!new URL(page.url()).pathname.endsWith('/login.html')) throw Error('login did not remain stable after revocation'); const stored=await page.evaluate(()=>{try{return JSON.parse(sessionStorage.getItem('HOMEEASY_AUTH_SESSION_V1')||'null')}catch{return null}}); if(stored&&stored.appSessionToken) throw Error('revoked appSessionToken is still present'); const email=await page.locator('#emailInput').inputValue(); if(!email) throw Error('known Firebase email was not preserved for re-login'); await context.close();});

await check('AR switches Sheer/Panel/Onda and produces ready model',async()=>{const context=await browser.newContext({viewport:{width:1280,height:800}}); const page=await context.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message)); await page.goto(base+'ar-homeeasy-v3.html',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1800); for(const v of ['sheer','panel','onda']){await page.selectOption('#product',v); await page.waitForTimeout(1500); const s=await page.locator('div#status').textContent(); const tone=await page.locator('div#status').getAttribute('data-tone'); const disabled=await page.locator('#ar-button').isDisabled(); notes.push(`AR ${v}: ${tone} / disabled=${disabled}`); if(tone==='error'||/error|no se pudo/i.test(s||'')) throw Error(`${v}: ${s}`); if(disabled) throw Error(`${v}: AR button remained disabled`);} const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2); if(overflow) throw Error('AR horizontal overflow'); if(errs.length) throw Error(errs.join(' | ')); await context.close();});

await check('AR mobile has no horizontal overflow',async()=>{const context=await browser.newContext({viewport:{width:390,height:844}}); const page=await context.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message)); await page.goto(base+'ar-homeeasy-v3.html',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1600); const o=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2); if(o) throw Error('horizontal overflow'); if(errs.length) throw Error(errs.join(' | ')); await context.close();});

await browser.close(); server.kill('SIGTERM');
console.log('NOTES',notes.join('; '));
if(failures.length){console.error('=== BROWSER FAILURES ==='); failures.forEach(x=>console.error(x)); process.exit(1);} else console.log('ALL BROWSER FIRE TESTS PASSED');
