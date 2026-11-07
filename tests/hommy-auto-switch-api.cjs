'use strict';
// Real Bridge HTTP contract test. All requests stay on localhost;
// no real WhatsApp credentials, sends, Meta data or OpenAI requests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

const root=path.join(__dirname,'../infra/whatsapp/bridge');
function freePort(){
  return new Promise((resolve,reject)=>{
    const s=net.createServer();
    s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});
  });
}
async function ready(base,proc){
  for(let i=0;i<70;i++){
    if(proc.exitCode!==null)throw Error('Bridge failed to start');
    try{
      const r=await fetch(base+'/health',{signal:AbortSignal.timeout(350)});
      if(r.ok)return;
    }catch(_){}
    await new Promise(resolve=>setTimeout(resolve,90));
  }
  throw Error('Bridge health endpoint not ready');
}
test('live Bridge: admin guarded customer-auto ON/OFF, conflict and invalid body',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-auto-ui-http-'));
  const port=await freePort();
  const key='test-bridge-key-'+process.pid;
  const proc=spawn(process.execPath,['server.js'],{
    cwd:root,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PORT:String(port),WAHA_API_KEY:'test-waha-key',
      BRIDGE_TOKEN:key,DATA_DIR:dir,HOMMY_INBOX_ENABLED:'true',
      OPENAI_API_KEY:'sk-'+'b'.repeat(50),WAHA_SESSION:'homeeasy',
      PENTAGRAMA_MODE:'direct',PENTAGRAMA_AGENT_TLS_PORT:'0'}
  });
  let stderr='';
  proc.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-2500)});
  t.after(()=>{proc.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true})});
  const base='http://127.0.0.1:'+port;
  try{await ready(base,proc)}catch(e){throw Error(String(e)+' '+stderr.slice(0,450))}
  const endpoint=base+'/api/whatsapp/hommy/customer-auto';
  const headers={'X-HomeEasy-Token':key,'Content-Type':'application/json'};
  const call=async(method,body,authorized=true)=>{
    const r=await fetch(endpoint,{
      method,headers:authorized?headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(2500)
    });
    return {status:r.status,body:await r.json()};
  };
  const unauthorized=await call('GET',undefined,false);
  assert.equal(unauthorized.status,401);
  const initial=await call('GET');
  assert.equal(initial.status,200);
  assert.equal(initial.body.customerAuto.enabled,false);
  assert.equal(initial.body.customerAuto.configured,true);
  const start=await call('POST',{enabled:true,expectedEnabled:false});
  assert.equal(start.status,200);
  assert.equal(start.body.customerAuto.enabled,true);
  assert.ok(start.body.customerAuto.activatedAt);
  const unchanged=await call('POST',{enabled:true,expectedEnabled:false});
  assert.equal(unchanged.status,409);
  const unsafe=await call('POST',{enabled:false,expectedEnabled:true,sendTo:'all'});
  assert.equal(unsafe.status,400);
  const unauthorizedStop=await call('POST',{enabled:false,expectedEnabled:true},false);
  assert.equal(unauthorizedStop.status,401);
  assert.equal((await call('GET')).body.customerAuto.enabled,true);
  const stop=await call('POST',{enabled:false,expectedEnabled:true});
  assert.equal(stop.status,200);
  assert.equal(stop.body.customerAuto.enabled,false);
  assert.equal((await call('GET')).body.customerAuto.enabled,false);
  const ctrl=JSON.parse(fs.readFileSync(path.join(dir,'hommy-customer-auto/control.json'),'utf8'));
  assert.equal(ctrl.enabled,false);
});
