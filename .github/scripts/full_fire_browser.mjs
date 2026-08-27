import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const server=spawn('python3',['-m','http.server','8090','--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(r=>setTimeout(r,900));
const base='http://127.0.0.1:8090/';
const permissions=['app.access','clientes.read','clientes.write','cotizaciones.read','cotizaciones.write','pedidos.read','pedidos.write','abonos.read','abonos.write','caja.read','caja.write','agenda.read','agenda.write','ventas.read','reportes.read','documentos.read','documentos.write','config.read','config.write','usuarios.read','usuarios.write','roles.read','roles.write','perfil.read','perfil.write','admin.audit','admin.security','system.manage','invitaciones.write'];
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken=`${b64({alg:'none',typ:'JWT'})}.${b64({aud:'homeeasy-auth',iss:'https://securetoken.google.com/homeeasy-auth',user_id:'audit-owner',sub:'audit-owner',email:'audit@example.com',email_verified:true,exp:Math.floor(Date.now()/1000)+3600})}.x`;
const session=(stale=false)=>({version:2,persistence:'session',localId:'audit-owner',email:'audit@example.com',displayName:'Audit Owner',idToken,refreshToken:'audit-refresh',expiresAt:Date.now()+3600_000,appSessionToken:'audit-app-token',appSessionExpiresAt:new Date(Date.now()+4*3600_000).toISOString(),appSessionValidatedAt:Date.now()-(stale?10*60_000:0),profile:{uid:'audit-owner',nombre:'Audit Owner',email:'audit@example.com',rol:'PROPIETARIO',estado:'ACTIVO',emailVerificado:true},permissions,savedAt:Date.now()});

function mockData(req){
  let tipo=''; try{ const d=JSON.parse(req.postData()||'{}'); tipo=d.tipo||'';}catch{}
  const u=new URL(req.url()); tipo=tipo||u.searchParams.get('tipo')||'';
  if(u.searchParams.get('init')) return {status:'ok',clientes:[[]],ordenes:[[]]};
  if(tipo==='EVENTOS_TODOS') return {status:'ok',eventos:[]};
  if(tipo==='GET_CONFIGURACION') return {status:'ok',configuracion:{empresa:{nombre:'HomeEasy'},caja:{nombre:'Caja Principal'},documentos:{}}};
  if(tipo==='AUTH_VALIDAR_SESION') return {status:'success',valido:true,profile:{uid:'audit-owner',nombre:'Audit Owner',email:'audit@example.com',rol:'PROPIETARIO',estado:'ACTIVO'},permissions,expiresAt:new Date(Date.now()+4*3600_000).toISOString()};
  if(tipo==='AUTH_PRESENCIA') return {status:'ok'};
  return {status:'ok',valido:true,data:[],clientes:[],ordenes:[],eventos:[],cotizaciones:[],ventas:[],feed:[],saldo:0,entradasMes:0,salidasMes:0,configuracion:{empresa:{nombre:'HomeEasy'},caja:{nombre:'Caja Principal'},documentos:{}}};
}

const browser=await chromium.launch({headless:true});
let failures=[]; let notes=[];
async function makePage({stale=false,networkFail=false,width=1280,height=800}={}){
  const context=await browser.newContext({viewport:{width,height}});
  await context.addInitScript(({s})=>{sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1',JSON.stringify(s));sessionStorage.setItem('APP_INIT_DONE','true');},{s:session(stale)});
  const page=await context.newPage();
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('https://script.google.com/**',async route=>{ if(networkFail) return route.abort('internetdisconnected'); return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mockData(route.request()))}); });
  await page.route('https://homeeasy-l5n1.onrender.com/**',r=>r.fulfill({status:204,body:''}));
  return {context,page,pageErrors};
}
async function check(name,fn){ try{await fn();console.log('PASS',name);}catch(e){failures.push(`${name}: ${e.message}`);console.log('FAIL',name,e.message);} }

await check('login desktop fits viewport',async()=>{const {context,page,pageErrors}=await makePage({width:1440,height:900}); await page.goto(base+'login.html'); await page.waitForTimeout(300); const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight})); if(m.sw>m.cw+2) throw Error(`horizontal overflow ${m.sw}/${m.cw}`); if(pageErrors.length) throw Error(pageErrors.join(' | ')); await context.close();});
await check('login mobile fits viewport',async()=>{const {context,page}=await makePage({width:390,height:844}); await page.goto(base+'login.html'); await page.waitForTimeout(250); const o=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2); if(o) throw Error('horizontal overflow'); await context.close();});

await check('index cached session opens without curtain',async()=>{const {context,page,pageErrors}=await makePage(); await page.goto(base+'index.html'); await page.waitForTimeout(500); const state=await page.evaluate(()=>({url:location.pathname,curtain:getComputedStyle(document.querySelector('#intro-curtain')).display,loading:document.documentElement.classList.contains('homeeasy-auth-pending'),nav:!!document.querySelector('.nav-groups')})); if(!state.nav||state.curtain!=='none'||state.loading) throw Error(JSON.stringify(state)); if(pageErrors.length) throw Error(pageErrors.join(' | ')); await context.close();});

await check('Index -> Caja -> back is instant and no intro',async()=>{const {context,page}=await makePage({width:390,height:844}); await page.goto(base+'index.html'); await page.waitForTimeout(350); await page.click('a[href="caja.html"]'); await page.waitForURL('**/caja.html'); await page.waitForTimeout(250); const start=Date.now(); await page.click('#pin-screen .fn-key'); await page.waitForURL('**/index.html',{timeout:2500}); await page.waitForSelector('.nav-groups',{timeout:1500}); const elapsed=Date.now()-start; const curtain=await page.evaluate(()=>getComputedStyle(document.querySelector('#intro-curtain')).display); if(elapsed>1500) throw Error(`return took ${elapsed}ms`); if(curtain!=='none') throw Error(`curtain=${curtain}`); notes.push(`Caja return ${elapsed}ms`); await context.close();});

for(const mod of ['clientes.html','ventas.html','cotizacion.html','seguimiento.html','pedido.html','abono.html','caja.html','documentos.html','calendario.html','reportes.html','configuracion.html','perfil.html','Hommychat.html','asistente.html']){
  await check(`guard authorizes ${mod}`,async()=>{const {context,page}=await makePage(); await page.goto(base+mod); await page.waitForTimeout(650); const st=await page.evaluate(()=>window.HomeEasyPageGuard?window.HomeEasyPageGuard.getStatus():'missing'); if(st!=='authorized') throw Error(`guard=${st}, url=${page.url()}`); await context.close();});
}

await check('temporary backend outage does not kick Index to login',async()=>{const {context,page}=await makePage({stale:true,networkFail:true}); await page.goto(base+'index.html'); await page.waitForTimeout(1400); if(page.url().includes('login.html')) throw Error('redirected to login on network failure'); await context.close();});
await check('temporary backend outage does not kick module to login',async()=>{const {context,page}=await makePage({stale:true,networkFail:true}); await page.goto(base+'clientes.html'); await page.waitForTimeout(1400); if(page.url().includes('login.html')) throw Error('redirected to login on network failure'); await context.close();});

await check('AR switches all products without UI crash',async()=>{const context=await browser.newContext({viewport:{width:1280,height:800}}); const page=await context.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message)); await page.goto(base+'ar-homeeasy-v3.html'); await page.waitForTimeout(1800); for(const v of ['sheer','panel','onda']){await page.selectOption('#product',v); await page.waitForTimeout(1300); const s=await page.locator('#status').textContent(); if(/error|no se pudo/i.test(s||'')) throw Error(`${v}: ${s}`);} const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2); if(overflow) throw Error('AR horizontal overflow'); if(errs.length) throw Error(errs.join(' | ')); await context.close();});

await browser.close(); server.kill('SIGTERM');
console.log('NOTES',notes.join('; '));
if(failures.length){console.error('=== BROWSER FAILURES ==='); failures.forEach(x=>console.error(x)); process.exit(1);} else console.log('ALL BROWSER FIRE TESTS PASSED');
