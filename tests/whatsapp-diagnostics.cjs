const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const auth=require('../infra/whatsapp/bridge/auth');
test('production CNAME is authorized by WhatsApp, arbitrary domains are rejected',()=>{
 const canonical='https://'+fs.readFileSync(path.join(root,'CNAME'),'utf8').trim();
 for(const origin of [canonical,'https://alejoherrera05-del.github.io']) {
  const headers={};assert.equal(auth.applyCors({headers:{origin}},{setHeader:(k,v)=>headers[k]=v}),true);
  assert.equal(headers['Access-Control-Allow-Origin'],origin);
 }
 for(const origin of ['https://attacker.example','https://hommy.homeeasy.com.co.attacker.example','null']) {
  assert.equal(auth.applyCors({headers:{origin}},{setHeader:()=>{}}),false);
 }
});
test('health diagnosis works independently of HomeEasy session and sends no credentials',async()=>{
 const d=new JSDOM('',{url:'https://hommy.homeeasy.com.co/pedido.html',runScripts:'outside-only'}),w=d.window;
 try {
  w.AbortController=AbortController;let request;
  w.fetch=async(url,options)=>{request={url,options};return {ok:true,status:200,json:async()=>({ok:true,version:'0.8.0'})};};
  w.eval(fs.readFileSync(path.join(root,'homeeasy-whatsapp-client.js'),'utf8'));
  const result=await w.HomeEasyWhatsApp.diagnose();
  assert.equal(result.server,'reachable');assert.equal(result.origin,'https://hommy.homeeasy.com.co');
  assert.equal(request.options.credentials,'omit');assert.equal(request.options.headers,undefined);
 } finally {w.close();}
});
for(const status of [0,401,403])test('failure '+status+' keeps diagnosis and maintenance visible',async()=>{
 const d=new JSDOM('<main class="content"></main>',{url:'https://hommy.homeeasy.com.co/configuracion.html#integraciones',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 try {
  const error=Object.assign(new Error('Test connection failure'),{status,code:'TEST_ERROR'});
  w.scrollTo=()=>{};w.HomeEasyPageGuard={getStatus:()=> 'authorized'};
  w.HomeEasyWhatsApp={status:async()=>{throw error;},maintenance:async()=>{throw error;},diagnose:async()=>({code:'NETWORK_OR_ORIGIN',server:'unreachable'})};
  w.eval(fs.readFileSync(path.join(root,'homeeasy-whatsapp-settings.js'),'utf8'));
  await new Promise(r=>setTimeout(r,30));
  assert.equal(w.document.getElementById('heWaDiagnosis').hidden,false);
  assert.equal(w.document.getElementById('heWaMaintenance').hidden,false);
  assert.match(w.document.getElementById('heWaDiagnosisDetails').textContent,/hommy.homeeasy.com.co/);
  assert.equal(w.document.getElementById('heWaMaintenanceUpdate').disabled,true);
  assert.equal(w.document.getElementById('heWaMaintenanceAuto').disabled,true);
  if(status===403)assert.match(w.document.getElementById('heWaMaintenanceMessage').textContent,/propietario/);
 } finally {w.close();}
});
