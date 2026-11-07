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
  wahaBase,readConversation,allowConversation,draftReply,sendOnce,claimId
}=require('./hommy-customer-pilot');

const LIMIT_PER_DAY=40;
const LIMIT_PER_CHAT_DAY=6;
const MAX_CONCURRENT=2;
const MAX_AGE_MS=90000;
const DEBOUNCE_MS=3500;
const SAFE_CHAT=/^\d{8,22}@(c\.us|lid)$/;
const RETAIN_AUDIT=1200;
function fingerprint(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,16);
}
function todayBogota(ms=Date.now()){
  return new Date(ms-5*3600000).toISOString().slice(0,10);
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
    return x.total+inFlight<=LIMIT_PER_DAY && x.chat<LIMIT_PER_CHAT_DAY;
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
      dailyLimit:LIMIT_PER_DAY,perChatDailyLimit:LIMIT_PER_CHAT_DAY,
      mode:'NEW_INBOUND_ONLY',typing:true};
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
    if(!eventEligible(record))return {queued:false,reason:'NOT_ELIGIBLE'};
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
  async function processOne(job){
    const record={id:job.id,chatId:job.chatId};
    const finish=(code)=>{recordOutcome(code,record);return code};
    if(!isEnabled())return finish('SKIP_DISABLED');
    if(!limitOk(job.chatId))return finish('SKIP_LIMIT');
    const claimFile=path.resolve(String(env.DATA_DIR||'/app/data'),
      'hommy-customer-pilot',claimId(job.chatId,job.id)+'.json');
    if(fs.existsSync(claimFile))return finish('SKIP_CLAIMED');
    let rows;
    try{rows=await getConversation(job.chatId)}
    catch(_){return finish('SKIP_CHAT_FETCH')}
    const check=allowConversation(rows);
    if(!check.ok||check.last.id!==job.id)return finish('SKIP_CHAT_CHANGED');
    if(!isEnabled())return finish('SKIP_DISABLED');
    // Real WAHA typing indication, not a displayed fake chat bubble.
    const started=await sendTyping(job.chatId,'typing');
    if(!started)return finish('SKIP_TYPING_UNAVAILABLE');
    try {
      const draft=await makeDraft(rows);
      if(!draft?.ok || typeof draft.text!=='string')
        return finish('SKIP_REVIEW_REQUIRED');
      if(!isEnabled())return finish('SKIP_DISABLED');
      // Hold typing briefly, with a bounded length-based variation.
      const hold=options.typingMs!==undefined?Number(options.typingMs):
        Math.min(5400,Math.max(1800,draft.text.length*27));
      await sleep(Math.max(0,hold));
      if(!isEnabled())return finish('SKIP_DISABLED');
      if(!limitOk(job.chatId))return finish('SKIP_LIMIT');
      try {
        await deliver(job.chatId,job.id,draft.text,{
          canSend:()=>isEnabled() && limitOk(job.chatId)
        });
        return finish('REQUEST_ACCEPTED');
      }catch(e){
        if(String(e.code||e.message||'').includes('CHAT_CHANGED'))return finish('SKIP_CHAT_CHANGED');
        if(String(e.code||e.message||'').includes('AUTOMATION_DISABLED'))return finish('SKIP_DISABLED');
        if(e.code==='EEXIST')return finish('SKIP_CLAIMED');
        return finish('SEND_UNKNOWN');
      }
    }catch(_){return finish('SKIP_AI_UNAVAILABLE')}
    finally{await sendTyping(job.chatId,'paused')}
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
  return Object.freeze({status,enable,disable,onInbound,processOne,isEnabled,
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
module.exports={createCustomerAuto,validRecord,todayBogota,fingerprint};
