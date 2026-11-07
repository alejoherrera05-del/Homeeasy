'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'homeeasy-hommy-operations-ui.js'),'utf8');
const clientScript=fs.readFileSync(path.join(root,'homeeasy-whatsapp-client.js'),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,15));
async function view(options={}){
  const d=new JSDOM('<main><section id="panel-integraciones" class="active"></section></main>',
    {url:'https://hommy.homeeasy.com.co/configuracion.html#integraciones',
      runScripts:'outside-only',pretendToBeVisual:true});
  const w=d.window;
  let enabled=options.enabled??false;
  let configured=options.configured??true;
  let permitted=options.permitted??true;
  let failed=options.failed??false;
  let confirmed=options.confirmed??true;
  const calls=[],dialogs=[];
  w.HomeEasyPageGuard={getStatus:()=> 'authorized'};
  w.HomeEasyAuth={hasPermission:p=>permitted&&p==='config.write'};
  w.Swal={fire:async obj=>{
    dialogs.push(obj);
    return {isConfirmed:confirmed};
  }};
  w.HomeEasyWhatsApp={
    hommyControl:async()=>({control:{
      mode:'REVIEW',revision:2,configRevision:2,pendingTasks:0,
      totalTeamCommands:0,team:{configured:false,enabled:false}
    }}),
    hommyCustomerAuto:async()=>{
      if(failed)throw Object.assign(Error('No response'),{status:503});
      return {ok:true,customerAuto:{
        enabled,configured,acceptedToday:4,pending:0,inFlight:0,typing:true
      }};
    },
    setHommyCustomerAuto:async(wanted,expected)=>{
      calls.push({wanted,expected});
      if(wanted===enabled && expected===enabled)throw Error('No change');
      if(expected!==enabled)throw Object.assign(Error('state changed'),{status:409});
      if(failed)throw Error('network timeout');
      enabled=wanted;
      return {ok:true,customerAuto:{
        enabled,configured,acceptedToday:4,pending:0,inFlight:0
      }};
    }
  };
  w.eval(script);
  await settle();await settle();
  return {
    w,d,calls,dialogs,
    switch:()=>w.document.getElementById('heHommyAutoSwitch'),
    state:()=>w.document.getElementById('heHommyAutoStateText').textContent,
    info:()=>w.document.getElementById('heHommyAutoInfo').textContent,
    setConfirmed:v=>{confirmed=v},
    setFailure:v=>{failed=v},
    setConfigured:v=>{configured=v},
    setPermission:v=>{permitted=v},
    close:()=>w.close()
  };
}
test('shows ON from actual VPS status and can turn OFF immediately without confirmation',async()=>{
  const v=await view({enabled:true});
  try{
    assert.equal(v.switch().getAttribute('role'),'switch');
    assert.equal(v.switch().getAttribute('aria-checked'),'true');
    assert.match(v.state(),/Activo/);
    assert.match(v.info(),/4 respuestas/);
    v.switch().click();
    await settle();await settle();
    assert.equal(v.calls.length,1);
    assert.deepEqual(v.calls[0],{wanted:false,expected:true});
    assert.equal(v.switch().getAttribute('aria-checked'),'false');
    assert.match(v.state(),/Apagado/);
    assert.equal(v.dialogs.some(x=>x.showCancelButton),false);
  }finally{v.close()}
});
test('requires explicit confirmation before turning ON and never acts on cancel',async()=>{
  const v=await view({enabled:false,confirmed:false});
  try{
    v.switch().click();
    await settle();await settle();
    assert.equal(v.calls.length,0);
    assert.equal(v.switch().getAttribute('aria-checked'),'false');
    assert.ok(v.dialogs.some(x=>x.showCancelButton));
    v.setConfirmed(true);
    v.switch().click();
    await settle();await settle();
    assert.deepEqual(v.calls[0],{wanted:true,expected:false});
    assert.equal(v.switch().getAttribute('aria-checked'),'true');
    assert.match(v.state(),/Activo/);
  }finally{v.close()}
});
test('read-only users can see state but cannot change the server',async()=>{
  const v=await view({enabled:true,permitted:false});
  try{
    assert.equal(v.switch().disabled,true);
    assert.equal(v.switch().getAttribute('aria-checked'),'true');
    v.switch().click();
    await settle();
    assert.equal(v.calls.length,0);
  }finally{v.close()}
});
test('unavailable backend is not falsely shown as OFF; the switch is locked',async()=>{
  const v=await view({enabled:true,failed:true});
  try{
    assert.equal(v.switch().disabled,true);
    assert.match(v.state(),/Estado no disponible/);
    v.switch().click();
    assert.equal(v.calls.length,0);
  }finally{v.close()}
});
test('not configured auto reply remains OFF and cannot be activated accidentally',async()=>{
  const v=await view({enabled:false,configured:false});
  try{
    assert.equal(v.switch().disabled,true);
    assert.match(v.state(),/Apagado/);
    assert.match(v.info(),/no está lista/);
  }finally{v.close()}
});
test('API client uses same authenticated session for GET and precise POST',async()=>{
  const d=new JSDOM('',{url:'https://hommy.homeeasy.com.co/configuracion.html',
    runScripts:'outside-only'});
  const w=d.window;w.AbortController=AbortController;
  w.HomeEasyAuth={getAppSessionToken:()=>'opaque-session-token',getDeviceIdentity:()=>null};
  const calls=[];
  w.fetch=async(url,opts)=>{
    calls.push({url,opts});
    return new Response(JSON.stringify({ok:true,customerAuto:{enabled:false}}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    w.eval(clientScript);
    await w.HomeEasyWhatsApp.hommyCustomerAuto();
    await w.HomeEasyWhatsApp.setHommyCustomerAuto(true,false);
    assert.equal(calls.length,2);
    assert.match(calls[0].url,/\/api\/whatsapp\/hommy\/customer-auto$/);
    assert.equal(calls[0].opts.method,'GET');
    assert.equal(calls[1].opts.method,'POST');
    assert.equal(calls[1].opts.headers['X-HomeEasy-Session'],'opaque-session-token');
    assert.deepEqual(JSON.parse(calls[1].opts.body),
      {enabled:true,expectedEnabled:false});
    await assert.rejects(()=>w.HomeEasyWhatsApp.setHommyCustomerAuto('true',false),
      err=>err.code==='HOMMY_AUTO_INVALID_SWITCH');
    assert.equal(calls.length,2);
  }finally{w.close()}
});
