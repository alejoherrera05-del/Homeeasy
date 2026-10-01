const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'he-maint-'));
process.env.MAINTENANCE_DIR=temp;
fs.mkdirSync(path.join(temp,'requests'));
const maint=require('../infra/whatsapp/bridge/maintenance');
const admin={profile:{rol:'ADMINISTRADOR',uid:'test'}};
const state=v=>fs.writeFileSync(path.join(temp,'status.json'),JSON.stringify({available:true,heartbeat:new Date().toISOString(),...v}));
test('maintenance rejects non-admin even with wildcard permissions',()=>{
 assert.throws(()=>maint.authorize({profile:{rol:'COMERCIAL'},permissions:['*']}),e=>e.statusCode===403);
 assert.doesNotThrow(()=>maint.authorize(admin));
 assert.doesNotThrow(()=>maint.authorize({profile:{rol:'PROPIETARIO'}}));
});
test('only fixed actions and one pending command accepted',()=>{
 state({});
 assert.throws(()=>maint.enqueue(admin,{action:'shell'}),e=>e.statusCode===400);
 const r=maint.enqueue(admin,{action:'automatic',enabled:true,command:'bad'});
 assert.ok(r.queued);const cmd=JSON.parse(fs.readFileSync(path.join(temp,'requests/command.json')));
 assert.equal(cmd.command,undefined);
 assert.throws(()=>maint.enqueue(admin,{action:'update'}),e=>e.statusCode===409);
 fs.unlinkSync(path.join(temp,'requests/command.json'));
});
test('drain preserves active sends and refuses new ones',()=>{
 state({});const done=maint.track();
 assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'requests/inflight.json'))).active,1);
 state({blockSends:true});assert.throws(()=>maint.track(),e=>e.statusCode===503);
 done();done();assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'requests/inflight.json'))).active,0);
});
test('unavailable worker refuses commands',()=>{
 state({heartbeat:'2020-01-01'});assert.throws(()=>maint.enqueue(admin,{action:'update'}),e=>e.statusCode===503);
});
test('settings maintenance exposes progress and automatic controls',async()=>{
 const {JSDOM}=require('jsdom');
 const d=new JSDOM('<main class="content"></main><div class="mobile-tabs"></div>',{url:'https://example.test/configuracion.html#integraciones',runScripts:'outside-only',pretendToBeVisual:true});
 const w=d.window;w.scrollTo=()=>{};w.HomeEasyPageGuard={getStatus:()=> 'authorized'};
 const calls=[];let enabled=true;
 w.HomeEasyWhatsApp={status:async()=>({bridge:{version:'0.8.0'},actor:{rol:'ADMINISTRADOR'},whatsapp:{ready:true,status:'WORKING'}}),connectedPhone:()=>'',maintenance:async()=>({available:true,heartbeat:new Date().toISOString(),automatic:enabled,currentVersion:'2026.9.1',latestVersion:'2026.9.1',jobId:'job'}),maintain:async body=>{calls.push(body);enabled=body.enabled;return {jobId:'job'};}};
 w.eval(fs.readFileSync(path.join(__dirname,'../homeeasy-whatsapp-settings.js'),'utf8'));
 await new Promise(r=>setTimeout(r,20));
 assert.equal(w.document.getElementById('heWaMaintenance').hidden,false);
 assert.equal(w.document.getElementById('heWaMaintenanceUpdate').disabled,true);
 w.document.getElementById('heWaMaintenanceAuto').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(calls[0].enabled,false);
 assert.match(w.document.getElementById('heWaMaintenanceSchedule').textContent,/pausada/);
 w.close();
});
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
