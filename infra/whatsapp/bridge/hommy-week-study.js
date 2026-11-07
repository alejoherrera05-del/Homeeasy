'use strict';
// One-shot, read-only WhatsApp weekly service review for HomeEasy.
// Nothing is sent to WhatsApp. The AI sees counts, categories and bounded,
// redacted STAFF replies only; raw customer text never goes to OpenAI.
// No long-term Hommy learning until the owner explicitly approves the draft.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createHommyDesk}=require('./hommy-desk');
const {normalizeMessages,timestampMs}=require('./conversation');
function metaReferralKind(raw){
  const c=raw?.ctwaContext||raw?.referral||raw?._data?.ctwaContext||raw?._data?.referral;
  if(!c||typeof c!=='object'||Array.isArray(c))return 'UNKNOWN';
  const type=String(c.sourceType||c.source_type||'').toLowerCase().trim();
  const evidence=Boolean(type||c.sourceId||c.source_id||c.sourceUrl||c.source_url||
    c.adId||c.ad_id);
  if(!evidence)return 'UNKNOWN';
  if(['ad','ads','sponsored'].includes(type))return 'META_AD';
  if(type==='post')return 'META_POST';
  return 'META_REFERRAL_UNCLASSIFIED';
}
function localInboxMetaEvidence(from,root){
  const evidence=new Map();
  const f=path.join(root,'hommy-inbox','events.ndjson');
  try {
    const stat=fs.statSync(f);
    if(!stat.isFile()||stat.size>12*1024*1024)return evidence;
    for(const line of fs.readFileSync(f,'utf8').split('\n')){
      if(!line||line.length>20000)continue;
      let item;try{item=JSON.parse(line)}catch(_){continue}
      if(!isDirectChat(item.chatId)||timestampMs(item.at)<from.getTime() ||
          item.direction!=='INCOMING')continue;
      const origin=item.commercialOrigin;
      if(origin && origin.verified===true && origin.campaign==='META'){
        const type=String(origin.sourceType||'').toLowerCase();
        const kind=type==='ad'?'META_AD':type==='post'?'META_POST':'META_REFERRAL_UNCLASSIFIED';
        evidence.set(item.chatId,kind);
      }
    }
  }catch(_){/* The inbox may be absent, old or temporarily unavailable. */}
  return evidence;
}
const DATA_DIR=path.resolve(process.env.DATA_DIR||'/app/data');
const REPORT_DIR=path.join(DATA_DIR,'hommy-desk','learning');
const UTC_OFFSET=5*3600000; // Colombia UTC-05, year-round.
const MAX_CHATS=120,MAX_MESSAGES_PER_CHAT=200,MAX_MODEL_EXAMPLES=18;
function weekWindow(now=new Date()){
  const local=new Date(now.getTime()-UTC_OFFSET);
  const day=(local.getUTCDay()+6)%7;
  const startLocal=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-day);
  const start=new Date(startLocal+UTC_OFFSET);
  const end=new Date(now);
  return {start,end,week:start.toISOString().slice(0,10)};
}
function isDirectChat(jid){
  return /^\d{8,22}@(c\.us|lid)$/.test(String(jid||''));
}
function chatIdentifier(chat){
  const id=chat?.id?._serialized||chat?.id?.user&&chat?.id?.server&&
    (chat.id.user+'@'+chat.id.server)||chat?.id||chat?.chatId||'';
  return typeof id==='string' && isDirectChat(id)?id:'';
}
function arrayData(value){
  if(Array.isArray(value))return value;
  if(Array.isArray(value?.data))return value.data;
  if(Array.isArray(value?.items))return value.items;
  if(Array.isArray(value?.chats))return value.chats;
  return [];
}
function removePersonal(value){
  const s=String(value||'').slice(0,360);
  if(/(?:contrase(?:n|ñ)a|password|token|api.key|cuenta bancaria|tarjeta|c[eé]dula|documento de identidad|identificaci[oó]n)/i.test(s))return '';
  const cleaned=s
    .replace(/(?:https?:\/\/|www\.)\S+/gi,'[enlace]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[correo]')
    .replace(/(?:\+?\d[\s().-]?){8,}\d/g,'[número privado]')
    .replace(/\$\s*\d[\d.,]*/g,'[precio]')
    .replace(/\b(?:calle|carrera|cra\.?|cll\.?|diagonal|transversal|barrio|urbanizaci[oó]n|conjunto|torre|apartamento|apto\.?|direcci[oó]n)\b[^,.!?]{0,85}/gi,'[ubicación]')
    .replace(/\b(?:señor(?:a)?|don|doña|sr\.?|sra\.?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/g,'[cliente]')
    .replace(/\b(hola|buenas|claro|perfecto|listo)[, ]{1,3}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?=[,!. ])/gi,'$1 [cliente]')
    .replace(/\s+/g,' ').trim().slice(0,230);
  if(cleaned.length<20 || /\d{6,}/.test(cleaned) || /[<>]/.test(cleaned))return '';
  return cleaned;
}
function intent(text){
  const q=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(precio|cuanto vale|cuanto valen|cuanto cuesta|cuanto cuestan|valor|cotizacion|cotizar|cuanto sale)\b/.test(q))return 'PRECIO_COTIZACION';
  if(/\b(catalogo|referencias|modelos|fotos|imagenes|opciones)\b/.test(q))return 'CATALOGO_REFERENCIAS';
  if(/\b(visita|medir|medidas|instalacion|instalar|domicilio)\b/.test(q))return 'VISITA_MEDIDAS';
  if(/\b(promocion|descuento|oferta|publicidad)\b/.test(q))return 'PROMOCION';
  if(/\b(blackout|sheer|screen|panel japones|onda serena|enrollable|cortina|persiana)\b/.test(q))return 'PRODUCTO';
  return 'INFORMACION_GENERAL';
}
function median(values){
  const ordered=values.filter(x=>Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
  return ordered.length ? Math.round(ordered[Math.floor((ordered.length-1)/2)]*10)/10 : null;
}
function publicStats(rows){
  const incoming=rows.filter(x=>x.direction==='INCOMING');
  const outgoing=rows.filter(x=>x.direction==='OUTGOING');
  const firstIn=incoming[0], firstResponse=firstIn && outgoing.find(x=>Date.parse(x.at)>Date.parse(firstIn.at));
  const lastIn=incoming.at(-1),lastOut=outgoing.at(-1);
  const noReply=Boolean(lastIn && (!lastOut || Date.parse(lastIn.at)>Date.parse(lastOut.at)));
  return {incoming:incoming.length,outgoing:outgoing.length,
    firstResponseMin:firstResponse && firstIn ? (Date.parse(firstResponse.at)-Date.parse(firstIn.at))/60000:null,
    lastInboundAfterOutbound:noReply,
    inquiries:incoming.map(m=>intent(m.text)),
    outbound:outgoing.map(m=>m.text).filter(Boolean)};
}
function summaryOf(conversations){
  const intents={},mins=[],excerpts=[];
  let incoming=0,outgoing=0,unanswered=0,verifiedMeta=0,verifiedAds=0,metaPosts=0;
  let greet=0,question=0,cta=0,emoji=0;
  for(const c of conversations){
    const s=publicStats(c.messages);
    incoming+=s.incoming;outgoing+=s.outgoing;
    if(s.lastInboundAfterOutbound)unanswered++;
    if(c.metaKind!=='UNKNOWN')verifiedMeta++;
    if(c.metaKind==='META_AD')verifiedAds++;
    if(c.metaKind==='META_POST')metaPosts++;
    if(s.firstResponseMin!==null)mins.push(s.firstResponseMin);
    for(const type of s.inquiries)intents[type]=(intents[type]||0)+1;
    for(const text of s.outbound){
      if(/^(?:hola|buenas|buenos d[ií]as|buenas tardes)/i.test(text))greet++;
      if(text.includes('?')||text.includes('¿'))question++;
      if(/\b(?:agendar|visita|cotizar|asesor|medidas|enviar|compartir|revisar|cu[aá]ndo|qu[eé] horario)\b/i.test(text))cta++;
      if(/[\u{1F300}-\u{1FAFF}]/u.test(text))emoji++;
      const safe=removePersonal(text);
      // Only short outgoing BUSINESS text, not raw customer messages. Anonymity
      // cannot be guaranteed; skip unusual, long or address-like excerpts.
      if(safe && safe.length<=180 && excerpts.length<MAX_MODEL_EXAMPLES &&
        !excerpts.includes(safe) && !/\[(?:correo|ubicación|número privado|enlace)\]/.test(safe))
        excerpts.push(safe);
    }
  }
  return {chatsExamined:conversations.length,incomingMessages:incoming,
    outgoingMessages:outgoing,metaReferralDetectedChats:verifiedMeta,
    confirmedMetaAdChats:verifiedAds,confirmedMetaPostChats:metaPosts,
    originUnknownChats:conversations.length-verifiedMeta,
    inboundAfterLastObservedReply:unanswered,
    observedFirstReplyMedianMinutes:median(mins),
    observedFirstReplySamples:mins.length,
    inboundIntents:intents,
    staffReplyStyle:{
      greetingsPercent:outgoing?Math.round(greet*100/outgoing):null,
      questionsPercent:outgoing?Math.round(question*100/outgoing):null,
      nextStepPercent:outgoing?Math.round(cta*100/outgoing):null,
      emojiPercent:outgoing?Math.round(emoji*100/outgoing):null
    },excerpts};
}
async function jsonGet(url,key,fetcher=fetch){
  const r=await fetcher(url,{method:'GET',headers:{'X-Api-Key':key,
    Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('WAHA_HTTP_'+r.status);
  const text=await r.text();
  if(text.length>7*1024*1024)throw Error('WAHA_RESPONSE_TOO_LARGE');
  return JSON.parse(text);
}
async function collectChats(opts={}){
  const key=String(opts.key||'');
  if(key.length<8)throw Error('WAHA_KEY_UNAVAILABLE');
  const base=new URL(String(opts.base||'http://waha:3000'));
  if(base.protocol!=='http:'||!['waha','127.0.0.1','localhost'].includes(base.hostname) ||
     !['3000',''].includes(base.port) ||base.pathname!=='/')throw Error('WAHA_BASE_INVALID');
  const session=String(opts.session||'homeeasy');
  if(!/^[a-z0-9_-]{2,80}$/i.test(session))throw Error('WAHA_SESSION_INVALID');
  const from=opts.from||weekWindow().start;
  const fetcher=opts.fetcher||fetch;
  const chats=[];const ids=new Set();let discovered=0;
  for(let offset=0;offset<400;offset+=100){
    const query=new URLSearchParams({limit:'100',offset:String(offset),
      sortBy:'messageTimestamp',sortOrder:'desc'});
    const arr=arrayData(await jsonGet(base.toString()+'api/'+session+'/chats?'+query,key,fetcher));
    for(const c of arr){
      const id=chatIdentifier(c);
      if(!id||ids.has(id))continue;
      ids.add(id);discovered++;
      const last=timestampMs(c.timestamp||c.lastMessage?.timestamp||c.lastMessageTimestamp||
        c.messageTimestamp||c.t);
      if(last && last<from.getTime())continue;
      if(chats.length<MAX_CHATS)chats.push(id);
    }
    if(arr.length<100||chats.length>=MAX_CHATS)break;
  }
  const conversations=[];
  let failures=0, truncated=discovered>MAX_CHATS, scanned=0;
  for(let i=0;i<chats.length;i+=3){
    const batch=chats.slice(i,i+3);
    const got=await Promise.all(batch.map(async chatId=>{
      try {
        let raw=[],incomplete=false;
        for(let offset=0;offset<MAX_MESSAGES_PER_CHAT;offset+=100){
          const q=new URLSearchParams({limit:'100',offset:String(offset),
            'filter.timestamp.gte':String(Math.floor(from.getTime()/1000)),
            downloadMedia:'false'});
          const item=arrayData(await jsonGet(base.toString()+'api/'+session+'/chats/'+
            encodeURIComponent(chatId)+'/messages?'+q,key,fetcher));
          raw=raw.concat(item);
          if(item.length<100)break;
          if(offset===100&&item.length===100)incomplete=true;
        }
        scanned++;
        const messages=normalizeMessages(raw,{since:from.toISOString(),limit:80});
        if(!messages.length)return null;
        const origins=raw.filter(m=>m.fromMe!==true).map(metaReferralKind);
        const metaKind=origins.includes('META_AD')?'META_AD':
          origins.includes('META_POST')?'META_POST':
          origins.includes('META_REFERRAL_UNCLASSIFIED')?'META_REFERRAL_UNCLASSIFIED':'UNKNOWN';
        return {chatId,messages,metaKind,truncated:incomplete||raw.length>80};
      }catch(e){failures++;return null;}
    }));
    for(const item of got)if(item)conversations.push(item);
  }
  const inboxEvidence=localInboxMetaEvidence(from,opts.dataDir||DATA_DIR);
  for(const item of conversations){
    const observed=inboxEvidence.get(item.chatId);
    if(item.metaKind==='UNKNOWN' && observed)item.metaKind=observed;
    if(item.metaKind==='META_REFERRAL_UNCLASSIFIED' && observed==='META_AD')
      item.metaKind=observed;
  }
  return {conversations,coverage:{candidateChats:chats.length,chatsFetched:scanned,
    chatsWithMessages:conversations.length,fetchErrors:failures,
    partial:truncated||failures>0||conversations.some(c=>c.truncated),
    maxChats:MAX_CHATS,maxMessagesPerChat:MAX_MESSAGES_PER_CHAT}};
}
function safeGuideline(value){
  const v=String(value||'').trim().slice(0,230);
  if(v.length<12||/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{8,}\b/i.test(v)||
    /(?:token|clave secreta|api.key|password)/i.test(v))return '';
  return v;
}
async function coach(stats,options={}){
  const key=String(options.key||'').trim();
  if(!/^sk-[A-Za-z0-9_-]{30,}$/.test(key))return {error:'OPENAI_NOT_CONFIGURED'};
  const model=String(options.model||'gpt-5.4-mini');
  if(!/^[a-z][a-z0-9.-]{2,79}$/.test(model))return {error:'INVALID_MODEL'};
  const examples=stats.excerpts.slice(0,MAX_MODEL_EXAMPLES);
  const input={period:options.period,source:'HOME_EASY_WEEK_OBSERVATIONS',
    coverage:options.coverage,stats:{...stats,excerpts:examples}};
  const prompt=[
    'Eres un auditor de atención comercial de HomeEasy (persianas y cortinas, Colombia).',
    'El JSON contiene estadísticas y únicamente FRAGMENTOS ANONIMIZADOS de mensajes SALIENTES de la empresa.',
    'No incluye mensajes originales de clientes; sus intenciones fueron clasificadas localmente.',
    'Analiza cómo responde el equipo, qué conserva del buen trato y qué puede mejorar al atender publicidad Meta.',
    'No afirmes que un lead viene de Meta si originUnknownChats no tiene evidencia.',
    'No inventes tiempos, conversiones, ventas, citas o prácticas no observadas.',
    'Propón un estilo de conversación humano, cercano, experto, sin frases robóticas ni voseo.',
    'Las reglas deben ser recomendaciones, no entrenar automáticamente ni dar permisos al asistente.',
    'No repitas números de clientes, nombres propios, direcciones, detalles privados ni citas literales.',
    'Devuelve JSON válido según el esquema.'
  ].join('\n');
  const schema={type:'object',additionalProperties:false,
    properties:{
      summary:{type:'string'},
      strengths:{type:'array',items:{type:'string'}},
      weaknesses:{type:'array',items:{type:'string'}},
      proposedGuidelines:{type:'array',items:{type:'string'}}
    },required:['summary','strengths','weaknesses','proposedGuidelines']};
  try {
    const f=options.fetcher||fetch;
    const r=await f('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model,input:[{role:'system',content:prompt},
        {role:'user',content:JSON.stringify(input)}],
        text:{format:{type:'json_schema',name:'hommy_weekly_study_v1',strict:true,schema}},
        reasoning:{effort:'none'},max_output_tokens:1050,store:false}),
      signal:AbortSignal.timeout(25000)
    });
    if(!r.ok)return {error:'OPENAI_HTTP_'+r.status};
    const response=await r.json();
    if(response.status!=='completed')return {error:'OPENAI_INCOMPLETE'};
    const txt=(response.output||[]).flatMap(m=>(m.content||[]).filter(c=>c.type==='output_text')
      .map(c=>c.text)).join('');
    const parsed=JSON.parse(txt);
    if(!parsed || !Array.isArray(parsed.proposedGuidelines))return {error:'INVALID_COACH_OUTPUT'};
    const guidelines=parsed.proposedGuidelines.slice(0,6).map(safeGuideline).filter(Boolean);
    if(!guidelines.length)return {error:'NO_SAFE_GUIDELINES'};
    return {summary:safeGuideline(parsed.summary)||'Análisis comercial realizado.',
      strengths:(parsed.strengths||[]).slice(0,4).map(safeGuideline).filter(Boolean),
      weaknesses:(parsed.weaknesses||[]).slice(0,4).map(safeGuideline).filter(Boolean),
      guidelines};
  }catch(_){return {error:'COACH_UNAVAILABLE'};}
}
function atomicReport(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+process.pid+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
async function review(opts={}){
  const win=opts.window||weekWindow();
  const data=await collectChats({key:opts.wahaKey||process.env.WAHA_API_KEY,
    base:opts.base||process.env.WAHA_BASE_URL||'http://waha:3000',
    session:opts.session||process.env.WAHA_SESSION||'homeeasy',
    from:win.start,dataDir:opts.dataDir,fetcher:opts.wahaFetcher});
  const stats=summaryOf(data.conversations);
  const generatedAt=new Date().toISOString();
  const report={
    version:1,week:win.week,periodStart:win.start.toISOString(),periodEnd:win.end.toISOString(),
    generatedAt,coverage:data.coverage,
    metrics:Object.fromEntries(Object.entries(stats).filter(([k])=>k!=='excerpts')),
    study:data.conversations.length?
      await coach(stats,{key:opts.openaiKey||process.env.OPENAI_API_KEY,
        model:opts.model||process.env.HOMMY_TEAM_OPENAI_MODEL,
        period:{start:win.start.toISOString(),end:win.end.toISOString()},
        coverage:data.coverage,fetcher:opts.openaiFetcher}) :
      {error:'NO_CONVERSATIONS_FOUND'},
    approved:false
  };
  const root=opts.reportDir||REPORT_DIR;
  atomicReport(path.join(root,'week-'+win.week+'.json'),report);
  return report;
}
function approveWeek(week,options={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(week||'')))throw Error('INVALID_WEEK');
  const folder=options.reportDir||REPORT_DIR;
  const file=path.join(folder,'week-'+week+'.json');
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  if(report.version!==1||report.week!==week||report.approved===true)
    throw Error('REPORT_NOT_APPROVABLE');
  if(!report.study||!Array.isArray(report.study.guidelines)||
    report.study.guidelines.length<2)throw Error('NO_APPROVED_GUIDELINES');
  const text=report.study.guidelines.slice(0,4).join(' ').slice(0,490);
  if(!safeGuideline(text))throw Error('GUIDELINES_UNSAFE');
  const desk=options.desk||createHommyDesk({dataDir:DATA_DIR});
  const topic='Atención comercial estudiada '+week;
  const current=desk.dashboard().notes.find(x=>x.active && x.topic===topic);
  if(current)desk.editNote({id:current.id,text,visibility:'TEAM'});
  else desk.addNote({topic,text,visibility:'TEAM'});
  report.approved=true;report.approvedAt=new Date().toISOString();
  atomicReport(file,report);
  return {approved:true,week,visibility:'TEAM',guidelinesCount:Math.min(4,report.study.guidelines.length)};
}
async function main(){
  const arg=process.argv[2]||'study';
  if(arg==='study'){
    const result=await review();
    process.stdout.write(JSON.stringify({week:result.week,
      periodStart:result.periodStart,periodEnd:result.periodEnd,
      coverage:result.coverage,metrics:result.metrics,
      study:result.study,approved:result.approved},null,2)+'\n');
    process.stdout.write('\nNo se envió ningún WhatsApp. El equipo no fue entrenado todavía.\n');
    if(result.study.guidelines)
      process.stdout.write('Para aprobar solo al equipo: node /app/hommy-week-study.js approve '+result.week+'\n');
  }else if(arg==='approve'){
    const week=process.argv[3]||weekWindow().week;
    process.stdout.write(JSON.stringify(approveWeek(week),null,2)+'\n');
  }else throw Error('ONLY_STUDY_OR_APPROVE_ALLOWED');
}
if(require.main===module)main().catch(e=>{
  process.stderr.write('Hommy study: '+String(e.message||'ERROR').slice(0,100)+'\n');
  process.exitCode=1;
});
module.exports={weekWindow,chatIdentifier,isDirectChat,metaReferralKind,removePersonal,intent,
  publicStats,summaryOf,collectChats,coach,review,approveWeek};
