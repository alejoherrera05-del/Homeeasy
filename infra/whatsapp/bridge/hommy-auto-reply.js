'use strict';
// HomeEasy customer auto-reply, explicit opt-in and disabled by default.
//
// Only HMAC-authenticated, newly received direct customer messages may enter.
// Uses the vetted single-customer pilot's exact model and send guards.
// Does not use Render, past inbox records, groups, broadcasts, or client actions.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {
  wahaBase,readConversation,allowConversation,draftReply,sendOnce,claimId,firstObservedReply,
  isMetaAdAutoGreeting
}=require('./hommy-customer-pilot');

const LIMIT_PER_DAY=40;
const LIMIT_PER_CHAT_DAY=6;
const MAX_CONCURRENT=2;
const MAX_AGE_MS=90000;
const DEBOUNCE_MS=3500;
const SAFE_CHAT=/^\d{8,22}@(c\.us|lid)$/;
const RETAIN_AUDIT=1200;
const HUMAN_HANDOFF_MS=24*60*60*1000;
const OWN_ECHO_MS=15*60*1000;
function fingerprint(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,16);
}
function todayBogota(ms=Date.now()){
  return new Date(ms-5*3600000).toISOString().slice(0,10);
}
// Emergency reply only for a narrow, ordinary sales request that passed
// the existing allowConversation() safeguards. Never fallback on payments,
// guarantees, complaints, personal data, or anything requiring a human.
function safeQuoteFallback(rows){
  if(!Array.isArray(rows)||rows.length===0)return null;
  const last=rows.at(-1);
  if(last?.direction!=='INCOMING'||last.hasMedia)return null;
  const raw=String(last.text||'').trim();
  if(!raw||raw.length>220)return null;
  const normalized=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase();
  if(!/\b(cotiz\w*|presupuesto|precio|cuanto (?:vale|cuesta))\b/.test(normalized)||
    !/\b(persiana\w*|cortina\w*|blackout|enrollable\w*|sheer|onda serena)\b/.test(normalized))
    return null;
  if(/\b(urgente|garantia|reclamo|pago|transferencia|factura|devolucion|reembolso|descuento|pedido|cita|visita|agendar|instalar|demanda|promocion|envio)\b/.test(normalized))
    return null;
  const first=firstObservedReply(rows);
  return first?
    'Hola! 😊 Soy Hommy, de HomeEasy. Te ayudo con tu cotización. Tienes algún estilo de persiana en mente?':
    'Claro! 😊 Te ayudo con tu cotización. Tienes algún estilo de persiana en mente o prefieres recomendaciones?';
}
function normalizeSalesText(text){
  return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().trim();
}
// A request explicitly for furniture is not a request for our decoration lines.
function furnitureReply(rows){
  const last=[...(Array.isArray(rows)?rows:[])].reverse()
    .find(x=>x?.direction==='INCOMING');
  const q=normalizeSalesText(last?.text);
  if(!q||q.length>500)return null;
  if(/\b(persianas?|cortinas?|papel (?:de )?colgadura|blackout|enrollables?)\b/.test(q))return null;
  if(/\b(sofas?|sillones?|juegos? de sala|juegos? de alcoba|alcoba completa|muebles?|mobiliario|comedores?|colchones?|camas?|cabeceros?|nocheros?|mesas? de comedor|escritorios?|butacas?|closets?|armarios?)\b/.test(q)){
    return 'En HomeEasy no manejamos muebles ni sofás 😊 Nos especializamos en persianas, cortinas y papel de colgadura.';
  }
  if(/\b(tienen|tiene|venden|manejan|busco|quiero|necesito)\b.{0,40}\bsalas?\b/.test(q)){
    return 'En HomeEasy manejamos persianas, cortinas y papel de colgadura 😊 Te refieres a persianas para la sala o a un juego de sala?';
  }
  return null;
}
function validRecord(record){
  return Boolean(record&&record.direction==='INCOMING' &&
    SAFE_CHAT.test(String(record.chatId||'')) &&
    typeof record.id==='string' && record.id.length>0 && record.id.length<=240 &&
    record.media?.present!==true &&
    typeof record.text==='string' && record.text.trim().length>0 &&
    record.text.length<=1800);
}
function createCustomerAuto(options={}){
  const dir=path.resolve(String(options.dataDir||process.env.DATA_DIR||'/app/data'),'hommy-customer-auto');
  const control=path.join(dir,'control.json');
  const auditPath=path.join(dir,'audit.ndjson');
  const handoffFile=path.join(dir,'human-takeovers.json');
  const ownEchoFile=path.join(dir,'own-outgoing.json');
  const lastInbound=new Map();
  function readPrivate(file){
    try{
      if(fs.statSync(file).size>256000)return {};
      const x=JSON.parse(fs.readFileSync(file,'utf8'));
      return x&&typeof x==='object'&&!Array.isArray(x)?x:{};
    }catch(_){return {}}
  }
  function writePrivate(file,rows){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const tmp=file+'.'+process.pid+'.tmp';
    try{
      fs.writeFileSync(tmp,JSON.stringify(rows),{mode:0o600});
      fs.renameSync(tmp,file);
    }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
  }
  function activeHumanTakeover(chatId){
    return Number(readPrivate(handoffFile)[fingerprint(chatId)]?.until||0)>Date.now();
  }
  function reserveOwnOutgoing(chatId,text){
    const now=Date.now(),key=fingerprint(chatId);
    const rows=readPrivate(ownEchoFile);
    for(const [id,v] of Object.entries(rows)){
      if(Number(v?.at||0)<now-OWN_ECHO_MS)delete rows[id];
    }
    rows[key]={at:now,hash:fingerprint(String(text).trim())};
    writePrivate(ownEchoFile,rows);
  }
  function isOwnOutgoing(chatId,text){
    const row=readPrivate(ownEchoFile)[fingerprint(chatId)];
    return row&&Date.now()-Number(row.at||0)<=OWN_ECHO_MS &&
      row.hash===fingerprint(String(text||'').trim());
  }
  function markHumanTakeover(record){
    const rows=readPrivate(handoffFile),now=Date.now();
    for(const [key,value] of Object.entries(rows)){
      if(Number(value?.until||0)<=now)delete rows[key];
    }
    const key=fingerprint(record.chatId);
    rows[key]={until:now+HUMAN_HANDOFF_MS,at:new Date().toISOString()};
    writePrivate(handoffFile,rows);
    if(timers.has(record.chatId))clearTimeout(timers.get(record.chatId).timer);
    timers.delete(record.chatId);
    ready.delete(record.chatId);
    recordOutcome('HUMAN_TAKEOVER',record);
  }
  const env=options.env||process.env;
  const configured=String(env.HOMMY_INBOX_ENABLED||'false')==='true' &&
    /^sk-[A-Za-z0-9_-]{30,}$/.test(String(env.OPENAI_API_KEY||'')) &&
    String(env.WAHA_API_KEY||'').length>=8;
  const config=options.wahaConfig||
    (configured?wahaBase(env):null);
  const fetcher=options.fetcher||fetch;
  const sleep=options.sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const getConversation=options.readConversation||((chatId)=>
    readConversation(chatId,config,fetcher));
  const makeDraft=options.draftReply||((rows)=>draftReply(rows,{
    apiKey:env.OPENAI_API_KEY,
    model:env.HOMMY_TEAM_OPENAI_MODEL||'gpt-5.4-mini',
    fetcher:options.aiFetcher||fetch
  }));
  const deliver=options.sendOnce||((chatId,msgId,text,sendOptions)=>
    sendOnce(config,chatId,msgId,text,{fetcher,...sendOptions}));
  const delay=Number.isFinite(options.debounceMs)?
    Math.max(0,Math.min(15000,options.debounceMs)):DEBOUNCE_MS;
  const timers=new Map(),ready=new Map(),busy=new Set();
  let inFlight=0;
  function safeControl(){
    try{
      const v=JSON.parse(fs.readFileSync(control,'utf8'));
      return v&&v.version===1&&typeof v.enabled==='boolean'&&
        typeof v.activatedAt==='string'?v:null;
    }catch(_){return null}
  }
  function isEnabled(){
    return configured && safeControl()?.enabled===true;
  }
  function writeControl(enabled){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const old=safeControl();
    const state={
      version:1,enabled,
      // Enabling an already-enabled worker must NOT move its start boundary.
      activatedAt:enabled && old?.enabled?
        old.activatedAt:new Date().toISOString(),
      changedAt:new Date().toISOString()
    };
    const temp=control+'.'+process.pid+'.tmp';
    try{
      fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});
      fs.renameSync(temp,control);
    }finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
    return status();
  }
  function readAudit(){
    try{
      const stat=fs.statSync(auditPath);
      if(!stat.isFile()||stat.size>2*1024*1024)return [];
      return fs.readFileSync(auditPath,'utf8').split('\n').filter(Boolean)
        .slice(-RETAIN_AUDIT).flatMap(line=>{
          try {const x=JSON.parse(line);return x&&x.day?[x]:[]}catch(_){return []}
        });
    }catch(_){return []}
  }
  function recordOutcome(outcome,record){
    const code=String(outcome||'ERROR').replace(/[^A-Z0-9_]/g,'').slice(0,36);
    const item={day:todayBogota(),at:new Date().toISOString(),
      chat:fingerprint(record?.chatId),event:fingerprint(record?.id),outcome:code};
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    fs.appendFileSync(auditPath,JSON.stringify(item)+'\n',{mode:0o600});
    // Bounded retention, never storing names, messages, chat IDs or secrets.
    try{
      const stat=fs.statSync(auditPath);
      if(stat.size>180000){
        const rows=readAudit().slice(-RETAIN_AUDIT);
        fs.writeFileSync(auditPath,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
      }
    }catch(_){/* Not a reason to retry WhatsApp sends. */}
  }
  function usage(chatId){
    const day=todayBogota();
    const chatKey=fingerprint(chatId);
    const counted=readAudit().filter(x=>x.day===day &&
      ['REQUEST_ACCEPTED','SEND_UNKNOWN'].includes(x.outcome));
    return {total:counted.length,chat:counted.filter(x=>x.chat===chatKey).length};
  }
  function limitOk(chatId){
    const x=usage(chatId);
    return x.total+Math.max(1,inFlight)<=LIMIT_PER_DAY && x.chat<LIMIT_PER_CHAT_DAY;
  }
  function status(){
    const ctrl=safeControl();
    const day=todayBogota();
    const all=readAudit().filter(x=>x.day===day);
    return {configured,enabled:isEnabled(),activatedAt:ctrl?.activatedAt||null,
      pending:timers.size+ready.size,inFlight,
      acceptedToday:all.filter(x=>x.outcome==='REQUEST_ACCEPTED').length,
      uncertainToday:all.filter(x=>x.outcome==='SEND_UNKNOWN').length,
      skippedToday:all.filter(x=>x.outcome.startsWith('SKIP_')).length,
      lastOutcome:all.at(-1)?.outcome||null,
      dailyLimit:LIMIT_PER_DAY,perChatDailyLimit:LIMIT_PER_CHAT_DAY,
      mode:'NEW_INBOUND_ONLY',typing:true,
      humanTakeovers:Object.values(readPrivate(handoffFile))
        .filter(x=>Number(x?.until||0)>Date.now()).length};
  }
  function enable(){
    if(!configured)throw Error('CONFIG_NOT_READY_INBOX_WAHA_OPENAI');
    return writeControl(true);
  }
  function disable(){
    for(const job of timers.values())clearTimeout(job.timer);
    timers.clear();ready.clear();
    return writeControl(false);
  }
  async function sendTyping(chatId,presence){
    const endpoint=presence==='typing'?'/api/startTyping':'/api/stopTyping';
    const body={session:config.session,chatId};
    async function post(url,data){
      const response=await fetcher(url,{
        method:'POST',headers:{'X-Api-Key':config.key,'Content-Type':'application/json'},
        body:JSON.stringify(data),signal:AbortSignal.timeout(5000)
      });
      if(!response.ok)throw Error('TYPING_HTTP_'+response.status);
    }
    const origin=new URL(config.url).origin;
    try {
      await post(origin+endpoint,body);
      return true;
    }catch(_){
      // Newer WAHA Presence API is supported by WEBJS as well.
      try{
        await post(config.url+'presence',{chatId,presence:presence==='typing'?'typing':'paused'});
        return true;
      }catch(_){return false}
    }
  }
  function eventEligible(record){
    if(!isEnabled()||!validRecord(record))return false;
    const activated=Date.parse(safeControl().activatedAt);
    const stamp=Date.parse(record.at||'');
    if(!Number.isFinite(stamp) || !Number.isFinite(activated))return false;
    const now=Date.now();
    // Ignore delayed/redelivered old messages and any history that predates
    // explicit opt-in, even after a Bridge restart.
    return stamp>=activated-5000 && stamp<=now+60000 &&
      now-stamp>=-60000 && now-stamp<=MAX_AGE_MS;
  }
  function onInbound(record){
    if(validRecord(record)){
      lastInbound.set(record.chatId,record);
      if(lastInbound.size>1000)lastInbound.delete(lastInbound.keys().next().value);
    }
    if(!eventEligible(record))return {queued:false,reason:'NOT_ELIGIBLE'};
    if(activeHumanTakeover(record.chatId))
      return {queued:false,reason:'HUMAN_TAKEOVER'};
    if(timers.size+ready.size>=80&&!timers.has(record.chatId)&&!ready.has(record.chatId))
      return {queued:false,reason:'QUEUE_FULL'};
    const chatId=record.chatId;
    if(timers.has(chatId))clearTimeout(timers.get(chatId).timer);
    const job={chatId,id:record.id,at:record.at};
    job.timer=setTimeout(()=>{
      timers.delete(chatId);
      ready.set(chatId,job);
      pump();
    },delay);
    timers.set(chatId,job);
    return {queued:true};
  }
  function onOutbound(record){
    if(!record||record.direction!=='OUTGOING'||
      !SAFE_CHAT.test(String(record.chatId||'')))return {paused:false};
    const now=Date.now(),at=Date.parse(record.at||'');
    if(!Number.isFinite(at)||at>now+60000||now-at>MAX_AGE_MS)
      return {paused:false,reason:'STALE_OUTBOUND'};
    if(isOwnOutgoing(record.chatId,record.text))
      return {paused:false,reason:'HOMMY_OWN_REPLY'};
    const previous=lastInbound.get(record.chatId);
    if(isMetaAdAutoGreeting(previous,record))
      return {paused:false,reason:'META_AD_GREETING'};
    markHumanTakeover(record);
    return {paused:true,reason:'HUMAN_TAKEOVER'};
  }
  async function processOne(job){
    const record={id:job.id,chatId:job.chatId};
    const finish=(code)=>{recordOutcome(code,record);return code};
    if(!isEnabled())return finish('SKIP_DISABLED');
    if(activeHumanTakeover(job.chatId))return finish('SKIP_HUMAN_TAKEOVER');
    if(!limitOk(job.chatId))return finish('SKIP_LIMIT');
    const claimFile=path.resolve(String(env.DATA_DIR||'/app/data'),
      'hommy-customer-pilot',claimId(job.chatId,job.id)+'.json');
    if(fs.existsSync(claimFile))return finish('SKIP_CLAIMED');
    let rows,check;
    // WAHA webhook delivery can precede chat-history indexing. Retry only
    // while the signed message is absent from WAHA history; never override
    // a newer message, a human reply, or a human-review safety decision.
    for(let attempt=0;attempt<3;attempt++){
      try{rows=await getConversation(job.chatId)}
      catch(_){
        if(attempt===2)return finish('SKIP_CHAT_FETCH');
        await sleep(900);continue;
      }
      check=allowConversation(rows);
      if(check.ok&&check.last.id===job.id)break;
      if(rows.some(m=>m?.id===job.id)){
        return finish(check.reason==='HUMAN_REVIEW_REQUIRED'?
          'SKIP_HUMAN_REVIEW':'SKIP_CHAT_CHANGED');
      }
      if(check.reason==='HUMAN_REVIEW_REQUIRED')return finish('SKIP_HUMAN_REVIEW');
      if(attempt===2)return finish('SKIP_CHAT_MISSING_EVENT');
      await sleep(900);
    }
    if(!isEnabled())return finish('SKIP_DISABLED');
    if(activeHumanTakeover(job.chatId))return finish('SKIP_HUMAN_TAKEOVER');
    if(check.metaAdGreetingIgnored)recordOutcome('META_AD_GREETING_IGNORED',record);
    // Typing is best-effort UI: a failed WAHA presence endpoint must not
    // cause a safe customer reply to disappear.
    const started=await sendTyping(job.chatId,'typing');
    try {
      const furniture=furnitureReply(rows);
      let draft=furniture?{ok:true,text:furniture}:await makeDraft(rows);
      let fallbackUsed=false;
      if(!draft?.ok || typeof draft.text!=='string'){
        // Only whitelisted, safe quote enquiries may use fixed copy.
        // All other model refusals and rejected drafts stay blocked.
        const fallback=safeQuoteFallback(rows);
        if(!fallback)return finish(draft?.reason==='DRAFT_FAILED_SAFETY_CHECK'?
          'SKIP_DRAFT_UNSAFE':'SKIP_REVIEW_REQUIRED');
        draft={ok:true,text:fallback};
        fallbackUsed=true;
      }
      if(!isEnabled())return finish('SKIP_DISABLED');
      if(activeHumanTakeover(job.chatId))return finish('SKIP_HUMAN_TAKEOVER');
      // Hold typing briefly, with a bounded length-based variation.
      const hold=options.typingMs!==undefined?Number(options.typingMs):
        Math.min(5400,Math.max(1800,draft.text.length*27));
      await sleep(Math.max(0,hold));
      if(!isEnabled())return finish('SKIP_DISABLED');
      if(activeHumanTakeover(job.chatId))return finish('SKIP_HUMAN_TAKEOVER');
      if(!limitOk(job.chatId))return finish('SKIP_LIMIT');
      try {
        reserveOwnOutgoing(job.chatId,draft.text);
        await deliver(job.chatId,job.id,draft.text,{
          canSend:()=>isEnabled() && !activeHumanTakeover(job.chatId) && limitOk(job.chatId)
        });
        if(fallbackUsed)recordOutcome('SAFE_QUOTE_FALLBACK_USED',record);
        return finish('REQUEST_ACCEPTED');
      }catch(e){
        if(String(e.code||e.message||'').includes('CHAT_CHANGED'))return finish('SKIP_CHAT_CHANGED');
        if(String(e.code||e.message||'').includes('AUTOMATION_DISABLED'))
          return finish(activeHumanTakeover(job.chatId)?'SKIP_HUMAN_TAKEOVER':'SKIP_DISABLED');
        if(e.code==='EEXIST')return finish('SKIP_CLAIMED');
        return finish('SEND_UNKNOWN');
      }
    }catch(_){return finish('SKIP_AI_UNAVAILABLE')}
    finally{if(started)await sendTyping(job.chatId,'paused')}
  }
  function pump(){
    if(!isEnabled())return;
    for(const [chatId,job] of ready){
      if(inFlight>=MAX_CONCURRENT)break;
      if(busy.has(chatId))continue;
      ready.delete(chatId);
      inFlight++;busy.add(chatId);
      processOne(job).catch(()=>recordOutcome('SKIP_EXCEPTION',job)).finally(()=>{
        inFlight--;busy.delete(chatId);pump();
      });
    }
  }
  return Object.freeze({status,enable,disable,onInbound,onOutbound,processOne,isEnabled,
    eventEligible,sendTyping});
}
async function main(){
  const op=process.argv[2]||'status';
  if(!['status','enable','disable'].includes(op))
    throw Error('USE_STATUS_ENABLE_OR_DISABLE');
  const bot=createCustomerAuto();
  const result=op==='enable'?bot.enable():op==='disable'?bot.disable():bot.status();
  console.log(JSON.stringify(result,null,2));
  if(op==='enable')console.log('Auto-reply activado SOLO para mensajes NUEVOS desde este momento.');
  if(op==='disable')console.log('Auto-reply desactivado. No se enviarán nuevos mensajes.');
}
if(require.main===module)main().catch(e=>{
  console.error('Hommy auto: '+String(e.message||'ERROR').slice(0,90));
  process.exitCode=1;
});
module.exports={createCustomerAuto,validRecord,todayBogota,fingerprint,safeQuoteFallback,furnitureReply};
