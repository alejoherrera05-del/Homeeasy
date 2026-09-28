const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const code=n=>fs.readFileSync(path.join(root,n),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
function page(name,html='') { const d=new JSDOM(html,{url:'https://example.test/'+name,runScripts:'outside-only'});const observers=[]; const Native=d.window.MutationObserver; d.window.MutationObserver=class extends Native { constructor(cb){super(cb);observers.push(this);} }; const close=d.window.close.bind(d.window);d.window.close=()=>{observers.forEach(o=>o.disconnect());close();};return d; }
function settings(status='authorized',state='complete') {
 const d=page('configuracion.html','<div class="mobile-tabs"></div><div class="side-nav"></div><main class="content"></main>');
 let ready=state, auth=status; Object.defineProperty(d.window.document,'readyState',{get:()=>ready});
 d.window.HomeEasyPageGuard={getStatus:()=>auth};
 return {d,w:d.window,ready:v=>ready=v,auth:v=>auth=v};
}
for(const mode of ['auth-before-script','auth-before-dom','auth-after-dom'])test('Integraciones: '+mode,async()=>{
 const f=settings(mode==='auth-after-dom'?'checking':'authorized',mode==='auth-before-dom'?'loading':'complete');
 f.w.eval(code('homeeasy-whatsapp-settings.js'));
 if(mode==='auth-before-dom'){assert.equal(f.w.document.querySelector('#panel-integraciones'),null);f.ready('complete');f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));}
 if(mode==='auth-after-dom'){assert.equal(f.w.document.querySelector('#panel-integraciones'),null);f.auth('authorized');f.w.dispatchEvent(new f.w.Event('homeeasy:page-auth-ready'));}
 f.w.dispatchEvent(new f.w.Event('pageshow'));f.w.dispatchEvent(new f.w.Event('homeeasy:page-auth-ready'));
 assert.equal(f.w.document.querySelectorAll('#panel-integraciones').length,1);assert.equal(f.w.document.querySelectorAll('[data-section="integraciones"]').length,2);f.d.window.close();
});
test('Integraciones no se monta sin autorización',()=>{const f=settings('denied');f.w.eval(code('homeeasy-whatsapp-settings.js'));f.w.dispatchEvent(new f.w.Event('homeeasy:page-auth-ready'));assert.equal(f.w.document.querySelector('#panel-integraciones'),null);f.w.close();});
async function guarded(resultStatus = "success"){
 const d=page('pedido.html','<div id="success-modal"><div class="success-box"><button class="btn-success-home">Inicio</button></div></div>');const w=d.window;
 w.HOMEEASY_AUTH_CONFIG={};w.HomeEasyAuth={isConfigured:()=>true,getCachedHomeEasySession:()=>({}),hasPermission:()=>true,getCurrentProfile:()=>({}),getAppSessionToken:()=> 'test-session'};
 w.HomeEasyCore={API_URL:'https://api.example.test',buildMeta:()=>({}),createRequestId:()=> 'test-id'};
 w.fetch=async()=>new Response(JSON.stringify({status:resultStatus}),{headers:{'Content-Type':'application/json'}});
 w.eval(code('homeeasy-page-guard.js'));await settle();return d;
}
for(const timing of ['before-actions','after-actions'])test('Botón y PDF capturados '+timing,async()=>{
 const d=await guarded(),w=d.window;
 if(timing==='after-actions')w.eval(code('homeeasy-whatsapp-doc-actions.js'));
 await w.fetch('https://api.example.test',{method:'POST',body:JSON.stringify({tipo:'pedido',pdfBase64:'JVBERi0=',nombreArchivo:'Pedido_100.pdf',numero:'100',telefono:'3001234567'})});
 if(timing==='before-actions')w.eval(code('homeeasy-whatsapp-doc-actions.js'));
 await settle();assert.equal(w.document.querySelectorAll('.he-wa-generated-btn').length,1);assert.equal(w.HomeEasyWhatsAppDocumentActions.getLatestGenerated().filename,'Pedido_100.pdf');
 assert.equal(w.HomeEasyPageGuard.getLatestGeneratedDocument().appSessionToken,undefined);w.close();
});
test('Guard no ofrece PDF si el guardado falla',async()=>{const d=await guarded('error'),w=d.window; await w.fetch('https://api.example.test',{method:'POST',body:JSON.stringify({tipo:'pedido',pdfBase64:'bad',nombreArchivo:'bad.pdf'})});assert.equal(w.HomeEasyPageGuard.getLatestGeneratedDocument(),null);w.close();});
function client(fetcher,permission=true){const d=page('pedido.html');const w=d.window;w.AbortController=AbortController;w.HomeEasyAuth={getAppSessionToken:()=> 'test',hasPermission:()=>permission};w.fetch=fetcher;w.eval(code('homeeasy-whatsapp-client.js'));return d;}
const response=p=>new Response(JSON.stringify(p),{headers:{'Content-Type':'application/json'}});
test('Verifica conexión y realiza un solo envío',async()=>{const calls=[];const d=client(async(url,o)=>{calls.push([url,o]);return response(url.endsWith('/status')?{whatsapp:{ready:true,status:'WORKING'}}:{ok:true,delivery:'SENT'});});const r=await d.window.HomeEasyWhatsApp.sendDocument({pdfBase64:'x',idempotencyKey:'same'});assert.equal(r.delivery,'SENT');assert.equal(calls.length,2);assert.equal(calls.filter(x=>x[1].method==='POST').length,1);d.window.close();});
test('No envía si el canal está desconectado',async()=>{const calls=[];const d=client(async u=>{calls.push(u);return response({whatsapp:{ready:false,status:'STOPPED'}});});await assert.rejects(d.window.HomeEasyWhatsApp.sendDocument({}),e=>e.code==='WHATSAPP_NOT_READY');assert.equal(calls.length,1);d.window.close();});
test('Vendedor sin config.read conserva envío',async()=>{const calls=[];const d=client(async u=>{calls.push(u);return response({ok:true,delivery:'SENT'});},false);await d.window.HomeEasyWhatsApp.sendDocument({});assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/send-document'));d.window.close();});
test('Respuesta incompleta no se considera éxito y no repite POST',async()=>{let count=0;const d=client(async()=>{count++;return new Response('not-json');},false);await assert.rejects(d.window.HomeEasyWhatsApp.sendDocument({}),e=>e.code==='WHATSAPP_INVALID_RESPONSE');assert.equal(count,1);d.window.close();});
test('UNKNOWN no dispara reintentos',async()=>{let count=0;const d=client(async()=>{count++;return response({ok:false,delivery:'UNKNOWN'});},false);assert.equal((await d.window.HomeEasyWhatsApp.sendDocument({})).delivery,'UNKNOWN');assert.equal(count,1);d.window.close();});

test('Fallo de descarga del módulo permite reintento al volver la conexión',async()=>{
 const d=await guarded(),w=d.window;const script=w.document.getElementById('homeeasyWhatsappClientScript');assert.ok(script);script.dispatchEvent(new w.Event('error'));await settle();assert.equal(w.document.getElementById('homeeasyWhatsappClientScript'),null);w.dispatchEvent(new w.Event('online'));assert.ok(w.document.getElementById('homeeasyWhatsappClientScript'));w.close();
});
for(const delivery of ['SENT','UNKNOWN','SENDING'])test('Confirmación visible para '+delivery,async()=>{
 const d=await guarded(),w=d.window;const alerts=[];
 w.Swal={fire:async options=>alerts.push(options)};
 w.HomeEasyWhatsApp={sendDocument:async()=>({ok:delivery==='SENT',delivery})};
 await w.fetch('https://api.example.test',{method:'POST',body:JSON.stringify({tipo:'pedido',pdfBase64:'JVBERi0=',nombreArchivo:'Pedido_100.pdf',numero:'100',telefono:'3001234567',nombre:'Cliente de prueba'})});
 w.eval(code('homeeasy-whatsapp-doc-actions.js'));await settle();w.document.querySelector('.he-wa-generated-btn').click();await settle();w.document.getElementById('heWaDialogConfirm').click();await settle();
 if(delivery==='SENT'){assert.equal(alerts.length,0);assert.match(w.document.getElementById('homeeasyWhatsappToast').textContent,/Documento enviado/);}else{assert.equal(alerts[0].title,'Envío sin confirmar');assert.equal(w.document.getElementById('homeeasyWhatsappToast'),null);}
 w.close();
});
