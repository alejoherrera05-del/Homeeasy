import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server=spawn('python3',['-m','http.server','8091','--bind','127.0.0.1'],{stdio:'ignore'}); await new Promise(r=>setTimeout(r,700));
const base='http://127.0.0.1:8091/';
const perms=['app.access','clientes.read'];
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const token=`${b64({alg:'none'})}.${b64({aud:'homeeasy-auth',iss:'https://securetoken.google.com/homeeasy-auth',user_id:'u',sub:'u',email:'audit@example.com',exp:Math.floor(Date.now()/1000)+3600})}.x`;
const s={version:2,persistence:'session',localId:'u',email:'audit@example.com',displayName:'Audit',idToken:token,refreshToken:'refresh',expiresAt:Date.now()+3600000,appSessionToken:'revoked-token',appSessionExpiresAt:new Date(Date.now()+14400000).toISOString(),appSessionValidatedAt:Date.now()-600000,profile:{uid:'u',nombre:'Audit',email:'audit@example.com',rol:'CONSULTA',estado:'ACTIVO'},permissions:perms,savedAt:Date.now()};
const browser=await chromium.launch({headless:true}); const context=await browser.newContext();
await context.addInitScript(({s})=>{if(!sessionStorage.getItem('HOMEEASY_AUTH_SESSION_V1'))sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1',JSON.stringify(s));sessionStorage.setItem('APP_INIT_DONE','true')},{s});
const page=await context.newPage();
const nav=[]; page.on('framenavigated',f=>{if(f===page.mainFrame()){nav.push(f.url());console.log('NAV',f.url())}});
page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
function type(req){try{return JSON.parse(req.postData()||'{}').tipo||''}catch{return ''}}
await page.route('https://script.google.com/**',async route=>{
 const t=type(route.request()); console.log('BACKEND',t);
 if(t==='AUTH_VALIDAR_SESION') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'error',valido:false,code:'APP_SESSION_REVOKED',msg:'revoked QA'})});
 if(t==='AUTH_ABRIR_SESION') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'error',valido:false,code:'APP_SESSION_REVOKED',msg:'still revoked QA'})});
 if(t==='AUTH_PRESENCIA') return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok"}'});
 return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok"}'});
});
await page.goto(base+'clientes.html',{waitUntil:'domcontentloaded'});
for(const ms of [100,400,900,1800]){
 await page.waitForTimeout(ms===100?100:ms-(ms===400?100:ms===900?400:900));
 const st=await page.evaluate(()=>{let s=null;try{s=JSON.parse(sessionStorage.getItem('HOMEEASY_AUTH_SESSION_V1')||'null')}catch{};return{url:location.href,app:s&&s.appSessionToken||'',firebase:!!(s&&s.refreshToken),email:s&&s.email||'',cached:window.HomeEasyAuth&&window.HomeEasyAuth.getCachedHomeEasySession?!!window.HomeEasyAuth.getCachedHomeEasySession():null,guard:window.HomeEasyPageGuard&&window.HomeEasyPageGuard.getStatus?window.HomeEasyPageGuard.getStatus():null}}).catch(e=>({evalError:e.message,url:page.url()}));
 console.log('STATE',ms,JSON.stringify(st));
}
console.log('NAVS',JSON.stringify(nav));
await browser.close(); server.kill('SIGTERM');
