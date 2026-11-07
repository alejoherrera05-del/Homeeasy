'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCustomerAuto,validRecord,todayBogota,safeQuoteFallback}=require('./hommy-auto-reply');
const CHAT='573001234567@c.us';
const GROUP='120363123456789012@g.us';
const CONFIG={url:'http://waha:3000/api/homeeasy/',session:'homeeasy',key:'waha-test-key'};
const ENV={HOMMY_INBOX_ENABLED:'true',WAHA_API_KEY:'waha-test-key',
  OPENAI_API_KEY:'sk-'+'z'.repeat(40),HOMMY_TEAM_OPENAI_MODEL:'gpt-5.4-mini'};
const goodText='Hola 😊 Soy Hommy, de HomeEasy. Con mucho gusto te ayudamos. Qué persiana necesitas cotizar?';
function tmp(t){
  const p=fs.mkdtempSync(path.join(os.tmpdir(),'homeeasy-auto-'));
  t.after(()=>fs.rmSync(p,{recursive:true,force:true}));
  return p;
}
function event(id='new-msg',chatId=CHAT){
  const at=new Date().toISOString();
  return {id,chatId,direction:'INCOMING',text:'2️⃣ Cotización y precios',
    at,media:{present:false}};
}
function rows(id='new-msg',text='2️⃣ Cotización y precios'){
  return [{id,at:new Date().toISOString(),direction:'INCOMING',text,hasMedia:false}];
}
function fixture(t,overrides={}){
  const dir=tmp(t),events=[];
  const env={...ENV,DATA_DIR:dir};
  let current=rows();
  const fetcher=async(url,options)=>{
    if(options.method==='POST'){
      const p=JSON.parse(options.body);
      events.push({kind:url.endsWith('/api/startTyping')?'typing':
        url.endsWith('/api/stopTyping')?'paused':'presence',chatId:p.chatId,url});
    }
    return {ok:true,status:200};
  };
  const auto=createCustomerAuto({
    dataDir:dir,env,wahaConfig:CONFIG,fetcher,
    readConversation:async()=>current,
    draftReply:async()=>({ok:true,text:goodText}),
    sendOnce:async(_chatId,_id,text,{canSend})=>{
      assert.equal(canSend(),true);
      events.push({kind:'send',text});
      return {status:'SENT'};
    },
    typingMs:0,debounceMs:0,sleep:async()=>{},
    ...overrides
  });
  return {auto,events,setRows:x=>{current=x},dir};
}
test('safe quote fallback matches ordinary quotes but not sensitive cases',()=>{
  assert.match(safeQuoteFallback(rows('q','Quiero cotizar una persiana para mi ventana')),/Hommy, de HomeEasy/);
  assert.match(safeQuoteFallback([
    {id:'before',direction:'OUTGOING',text:'Hola'},
    ...rows('q2','Quiero cotizar una persiana para mi ventana')
  ]),/Te ayudo con tu cotización/);
  assert.equal(safeQuoteFallback(rows('x','Necesito garantía de una persiana')),null);
  assert.equal(safeQuoteFallback(rows('x','Quiero cotizar una persiana para una visita mañana')),null);
  assert.equal(safeQuoteFallback(rows('x','Quiero cotizar un papel colgadura')),null);
  assert.equal(safeQuoteFallback(rows('x','Hola buenas tardes')),null);
});
test('whitelisted quote receives safe fallback when model requests review',async t=>{
  const latest=rows('new-msg','Quiero cotizar una persiana para mi ventana');
  const {auto,events}=fixture(t,{
    readConversation:async()=>latest,
    draftReply:async()=>({ok:false,reason:'REVIEW_REQUIRED'})
  });
  auto.enable();
  assert.equal(await auto.processOne(event()),'REQUEST_ACCEPTED');
  const sent=events.find(x=>x.kind==='send');
  assert.match(sent.text,/cotización/);
  assert.equal(auto.status().acceptedToday,1);
  assert.equal(auto.status().lastOutcome,'REQUEST_ACCEPTED');
});
test('Meta-ad automatic greeting does not silence the signed inbound customer message',async t=>{
  const at=Date.now()-2500;
  const incoming={id:'new-msg',direction:'INCOMING',at:new Date(at).toISOString(),
    text:'Hola buena tarde',hasMedia:false};
  const greeting={id:'meta-welcome',direction:'OUTGOING',
    at:new Date(at+1000).toISOString(),hasMedia:false,
    text:'👋 ¡Te damos la bienvenida a HomeEasy! 🎉 Transformamos tus espacios con persianas y papel de colgadura diseñados para dar estilo, privacidad y funcionalidad ✨ 🎁 Este mes puedes aprovechar hasta 30% de descuento en referencias seleccionadas para renovar tu hogar con elegancia 🏡'};
  const {auto,events,dir}=fixture(t,{
    readConversation:async()=>[incoming,greeting]
  });
  auto.enable();
  assert.equal(await auto.processOne(event('new-msg')),'REQUEST_ACCEPTED');
  assert.equal(events.filter(x=>x.kind==='send').length,1);
  const log=fs.readFileSync(path.join(dir,'hommy-customer-auto','audit.ndjson'),'utf8');
  assert.match(log,/META_AD_GREETING_IGNORED/);
});
test('disabled by default, only explicit enable opens future-message boundary',t=>{
  const {auto}=fixture(t);
  assert.equal(auto.status().configured,true);
  assert.equal(auto.status().enabled,false);
  assert.equal(auto.onInbound(event()).queued,false);
  const old=event('old');
  old.at=new Date(Date.now()-120000).toISOString();
  auto.enable();
  assert.equal(auto.status().enabled,true);
  assert.equal(auto.eventEligible(old),false);
  assert.equal(auto.eventEligible(event('new')),true);
  const disabled=auto.disable();
  assert.equal(disabled.enabled,false);
  assert.equal(auto.onInbound(event('after-stop')).queued,false);
});
test('fails closed if OpenAI, WAHA or signed Inbox integration missing',t=>{
  const dir=tmp(t);
  const auto=createCustomerAuto({
    dataDir:dir,
    env:{HOMMY_INBOX_ENABLED:'false',OPENAI_API_KEY:'',WAHA_API_KEY:''}
  });
  assert.equal(auto.status().configured,false);
  assert.throws(()=>auto.enable(),/CONFIG_NOT_READY/);
});
test('no groups, broadcasts, outgoing, media or empty messages are candidates',t=>{
  const x=event();
  assert.equal(validRecord(x),true);
  assert.equal(validRecord({...x,chatId:GROUP}),false);
  assert.equal(validRecord({...x,chatId:'status@broadcast'}),false);
  assert.equal(validRecord({...x,direction:'OUTGOING'}),false);
  assert.equal(validRecord({...x,media:{present:true}}),false);
  assert.equal(validRecord({...x,text:''}),false);
});
test('signed new events are debounced into one reply per last customer message',async t=>{
  const {auto,events,setRows}=fixture(t);
  auto.enable();
  const first=event('first');
  const next=event('second');
  setRows(rows('second'));
  assert.equal(auto.onInbound(first).queued,true);
  assert.equal(auto.onInbound(next).queued,true);
  await new Promise(resolve=>setTimeout(resolve,110));
  assert.deepEqual(events.map(e=>e.kind),['typing','send','paused']);
  assert.equal(auto.status().acceptedToday,1);
});
test('one new customer request shows real typing during AI, then sends and stops typing',async t=>{
  const {auto,events}=fixture(t);
  auto.enable();
  const result=await auto.processOne(event());
  assert.equal(result,'REQUEST_ACCEPTED');
  assert.deepEqual(events.map(e=>e.kind),['typing','send','paused']);
  assert.equal(events[0].chatId,CHAT);
  assert.equal(auto.status().acceptedToday,1);
});
test('old customer message or human reply blocks all typing and sending',async t=>{
  const {auto,events,setRows}=fixture(t);
  auto.enable();
  setRows([{id:'m1',direction:'INCOMING',at:new Date().toISOString(),text:'Hola'},
    {id:'from-staff',direction:'OUTGOING',at:new Date().toISOString(),text:'Hola!'}]);
  assert.equal(await auto.processOne(event('m1')),'SKIP_CHAT_CHANGED');
  assert.deepEqual(events,[]);
  setRows(rows('newer'));
  assert.equal(await auto.processOne(event('old')),'SKIP_CHAT_MISSING_EVENT');
  assert.deepEqual(events,[]);
});
test('transient WAHA chat history lag retries and then replies once',async t=>{
  let reads=0;
  const {auto,events}=fixture(t,{
    readConversation:async()=>{
      reads++;
      return reads<=2?rows('older'):rows('new-msg');
    }
  });
  auto.enable();
  assert.equal(await auto.processOne(event('new-msg')),'REQUEST_ACCEPTED');
  assert.equal(reads,3);
  assert.equal(events.filter(x=>x.kind==='send').length,1);
});
test('missing webhook message after bounded WAHA reads is audited safely',async t=>{
  let reads=0;
  const {auto,events}=fixture(t,{
    readConversation:async()=>{reads++;return rows('other');}
  });
  auto.enable();
  assert.equal(await auto.processOne(event('new-msg')),'SKIP_CHAT_MISSING_EVENT');
  assert.equal(reads,3);
  assert.deepEqual(events,[]);
});
test('concurrent emergency disable prevents final send and stops typing',async t=>{
  let auto;
  const {events,auto:instance}=fixture(t,{
    draftReply:async()=>{
      auto.disable();
      return {ok:true,text:goodText};
    }
  });
  auto=instance;
  auto.enable();
  assert.equal(await auto.processOne(event()),'SKIP_DISABLED');
  assert.deepEqual(events.map(x=>x.kind),['typing','paused']);
});
test('sensitive conversation flagged for human review does not trigger typing',async t=>{
  const {auto,events,setRows}=fixture(t);
  auto.enable();
  setRows(rows('new-msg','Quiero hacer un reclamo de mi pedido'));
  assert.equal(await auto.processOne(event()),'SKIP_HUMAN_REVIEW');
  assert.equal(events.length,0);
});
test('AI refusal or failure never sends; typing stops in both cases',async t=>{
  const {auto,events}=fixture(t,{draftReply:async()=>({ok:false,reason:'REVIEW_REQUIRED'})});
  auto.enable();
  assert.equal(await auto.processOne(event()),'SKIP_REVIEW_REQUIRED');
  assert.deepEqual(events.map(e=>e.kind),['typing','paused']);
});
test('invalid commercial drafts have a distinct audit outcome but are never sent',async t=>{
  const {auto,events}=fixture(t,{draftReply:async()=>({
    ok:false,reason:'DRAFT_FAILED_SAFETY_CHECK'
  })});
  auto.enable();
  assert.equal(await auto.processOne(event()),'SKIP_DRAFT_UNSAFE');
  assert.deepEqual(events.map(e=>e.kind),['typing','paused']);
  assert.equal(auto.status().lastOutcome,'SKIP_DRAFT_UNSAFE');
});
test('typing API fallback to WAHA presence and paused is supported',async t=>{
  const events=[];
  const {auto}=fixture(t,{fetcher:async(url,req)=>{
    events.push(url);
    return url.endsWith('/api/startTyping')||url.endsWith('/api/stopTyping')?
      {ok:false,status:404}:{ok:true,status:200};
  }});
  auto.enable();
  assert.equal(await auto.processOne(event()),'REQUEST_ACCEPTED');
  assert.ok(events.includes('http://waha:3000/api/startTyping'));
  assert.ok(events.includes('http://waha:3000/api/homeeasy/presence'));
  assert.ok(events.includes('http://waha:3000/api/stopTyping'));
});
test('typing API total failure does not silence a safe customer reply',async t=>{
  const attempts=[];
  const {auto,events}=fixture(t,{fetcher:async(url)=>{
    attempts.push(url);
    return {ok:false,status:404};
  }});
  auto.enable();
  assert.equal(await auto.processOne(event()),'REQUEST_ACCEPTED');
  assert.equal(attempts.length,2);
  assert.deepEqual(events.map(e=>e.kind),['send']);
});
test('daily per-chat quota stops repeated automatic replies',async t=>{
  let latest='m0';
  const {auto,events}=fixture(t,{readConversation:async()=>rows(latest)});
  auto.enable();
  for(let i=0;i<6;i++){
    latest='m'+i;
    assert.equal(await auto.processOne(event(latest)),'REQUEST_ACCEPTED');
  }
  latest='m7';
  assert.equal(await auto.processOne(event(latest)),'SKIP_LIMIT');
  assert.equal(events.filter(e=>e.kind==='send').length,6);
});
test('a failed, uncertain WAHA send does not automatically retry',async t=>{
  const {auto,events}=fixture(t,{sendOnce:async()=>{
    throw Error('WAHA_SEND_STATUS_UNKNOWN_CHECK_WHATSAPP_BEFORE_RETRY');
  }});
  auto.enable();
  assert.equal(await auto.processOne(event()),'SEND_UNKNOWN');
  assert.equal(auto.status().uncertainToday,1);
  assert.deepEqual(events.map(x=>x.kind),['typing','paused']);
});
test('Bogotá daily quota time uses UTC-5, not UTC midnight',()=>{
  assert.equal(todayBogota(Date.parse('2026-11-07T03:30:00Z')),'2026-11-06');
  assert.equal(todayBogota(Date.parse('2026-11-07T05:30:00Z')),'2026-11-07');
});
