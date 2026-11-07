'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  weekWindow,chatIdentifier,isDirectChat,metaReferralKind,removePersonal,
  intent,publicStats,summaryOf,collectChats,coach,review,approveWeek
}=require('./hommy-week-study');

const start=new Date('2026-11-02T05:00:00.000Z');
const end=new Date('2026-11-07T15:00:00.000Z');
const session='homeeasy';
const customer='573001234567@c.us';
const second='573008881122@c.us';
const key='waha-test-key-long';
const api='sk-'+'a'.repeat(40);
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-week-study-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function message(id, timestamp, fromMe, body, rest={}){
  return {id,timestamp,fromMe,body,...rest};
}
const sampleChats=[
  {id:{_serialized:customer},timestamp:1794050000},
  {id:second,timestamp:1794051000},
  {id:'120363123456789012@g.us',timestamp:1794051100},
  {id:'status@broadcast',timestamp:1794051000}
];
const customerMessages=[
  message('in-1',1794050000,false,'Hola, ¿cuánto cuestan las persianas blackout?',
    {referral:{source_type:'ad',source_id:'meta-ad-17',headline:'Persianas'}}),
  message('out-1',1794050120,true,'Hola, Laura, gracias por escribirnos. ¿En qué espacio la necesitas?'),
  message('out-2',1794050200,true,'Claro, te podemos asesorar según las medidas de tu ventana.')
];
const secondMessages=[
  message('in-2',1794051000,false,'Buenas, quiero el catálogo por favor.')
];
function wahaMock(url,opts){
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers['X-Api-Key'],key);
  assert.match(url,/^http:\/\/waha:3000\/api\/homeeasy\//);
  if(url.includes('/chats?'))return Promise.resolve({
    ok:true,text:async()=>JSON.stringify(sampleChats)
  });
  const rows=url.includes(encodeURIComponent(customer))?customerMessages:secondMessages;
  return Promise.resolve({ok:true,text:async()=>JSON.stringify(rows)});
}
function coachMock(optsSink){
  return async(url,opts)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(opts.headers.Authorization,'Bearer '+api);
    optsSink.push(JSON.parse(opts.body));
    return {ok:true,json:async()=>({
      status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
        summary:'El equipo pregunta por el espacio y ofrece asesoría.',
        strengths:['Ofrece asesoría según la necesidad.'],
        weaknesses:['A veces falta cerrar con un paso concreto.'],
        proposedGuidelines:[
          'Responder con cercanía y preguntar por el espacio antes de recomendar la referencia.',
          'Pedir las medidas del vano cuando se necesiten para avanzar con una cotización.',
          'Cerrar con un siguiente paso concreto, sin prometer fechas o descuentos.'
        ]
      })}]}]
    })};
  };
}
test('Colombia current week starts Monday Nov 2 and uses local midnight',()=>{
  const w=weekWindow(end);
  assert.equal(w.week,'2026-11-02');
  assert.equal(w.start.toISOString(),'2026-11-02T05:00:00.000Z');
  assert.equal(w.end.toISOString(),end.toISOString());
});
test('groups, status and broadcasts are never customer chats',()=>{
  assert.equal(chatIdentifier(sampleChats[0]),customer);
  assert.equal(chatIdentifier(sampleChats[1]),second);
  assert.equal(chatIdentifier(sampleChats[2]),'');
  assert.equal(chatIdentifier(sampleChats[3]),'');
  assert.equal(isDirectChat('1234567890@lid'),true);
});
test('Meta ad and organic/unverified referral sources are clearly distinct',()=>{
  assert.equal(metaReferralKind(customerMessages[0]),'META_AD');
  assert.equal(metaReferralKind({referral:{source_type:'post',source_id:'abc'}}),'META_POST');
  assert.equal(metaReferralKind({referral:{source_id:'abc'}}),'META_REFERRAL_UNCLASSIFIED');
  assert.equal(metaReferralKind({body:'Hola, vi su publicidad en Facebook'}),'UNKNOWN');
});
test('private data is removed before any OpenAI style study',()=>{
  const msg='Hola, Laura, envío a calle 8 #16-17, correo laura@private.test, cel +57 300 333 4499 y precio $1.600.000.';
  const clean=removePersonal(msg);
  assert.doesNotMatch(clean,/Laura|private.test|300 333|calle 8|1.600.000/);
  assert.match(clean,/\[cliente\]/);
  assert.equal(removePersonal('La contraseña del correo es 123456'), '');
  assert.equal(removePersonal('OK'), '');
});
test('intent taxonomy observes customer messages without claiming paid advertising',()=>{
  assert.equal(intent('¿cuánto cuesta sheer elegance?'),'PRECIO_COTIZACION');
  assert.equal(intent('Me envías catálogo'),'CATALOGO_REFERENCIAS');
  assert.equal(intent('Necesito medidas para instalar'),'VISITA_MEDIDAS');
  assert.equal(intent('Hola, me interesa'),'INFORMACION_GENERAL');
});
test('API-generated automatic replies never become models for human sales style',()=>{
  const rows=[
    {direction:'INCOMING',at:'2026-11-07T14:00:00Z',text:'Hola, ¿me ayudas?'},
    {direction:'OUTGOING',at:'2026-11-07T14:01:00Z',
      text:'MENSAJE AUTOMATICO: código de pedido',source:'api'},
    {direction:'OUTGOING',at:'2026-11-07T14:03:00Z',
      text:'Claro, te ayudo con la referencia que buscas.',source:'web'}
  ];
  const metrics=publicStats(rows);
  assert.equal(metrics.outgoing,1);
  assert.equal(metrics.automated,1);
  assert.equal(metrics.firstResponseMin,3);
  const summary=summaryOf([{messages:rows,metaKind:'UNKNOWN'}]);
  assert.equal(summary.outgoingMessages,1);
  assert.equal(summary.automatedOutboundMessages,1);
  assert.doesNotMatch(JSON.stringify(summary.excerpts),/MENSAJE AUTOMATICO/);
});

test('weekly study retrieves observed messages without sending texts to WAHA',async t=>{
  const dir=fixture(t),sink=[];
  const report=await review({window:{start,end,week:'2026-11-02'},
    dataDir:dir,reportDir:path.join(dir,'reports'),
    wahaKey:key,wahaFetcher:wahaMock,openaiKey:api,openaiFetcher:coachMock(sink)});
  assert.equal(report.week,'2026-11-02');
  assert.equal(report.coverage.chatsWithMessages,2);
  assert.equal(report.coverage.fetchErrors,0);
  assert.equal(report.metrics.incomingMessages,2);
  assert.equal(report.metrics.outgoingMessages,2);
  assert.equal(report.metrics.confirmedMetaAdChats,1);
  assert.equal(report.metrics.confirmedMetaPostChats,0);
  assert.equal(report.metrics.originUnknownChats,1);
  assert.equal(report.metrics.inboundAfterLastObservedReply,1);
  assert.equal(report.study.guidelines.length,3);
  assert.equal(report.approved,false);
  assert.equal(sink.length,1);
  assert.equal(sink[0].store,false);
  assert.equal(sink[0].tools,undefined);
  assert.equal(sink[0].model,'gpt-5.4-mini');
  const aiStats=JSON.parse(sink[0].input[1].content).stats;
  assert.equal(aiStats.pairedStyle.length,1);
  assert.equal(aiStats.pairedStyle[0].origin,'META_AD');
  assert.equal(aiStats.pairedStyle[0].customerIntent,'PRECIO_COTIZACION');
  assert.match(aiStats.pairedStyle[0].businessReply,/\[cliente\]/);
  assert.equal(report.metrics.pairedStyle,undefined);
  const actual=JSON.stringify(sink[0].input);
  assert.doesNotMatch(actual,/Laura|573001234567|573008881122|@c\.us|meta-ad-17|¿cuánto cuestan/);
  assert.equal(fs.existsSync(path.join(dir,'reports','week-2026-11-02.json')),true);
  const disk=fs.readFileSync(path.join(dir,'reports','week-2026-11-02.json'),'utf8');
  assert.doesNotMatch(disk,/573001234567|Laura|@c\.us|meta-ad-17/);
});
test('study cannot approve memory automatically; explicit approval is team-only',async t=>{
  const dir=fixture(t);
  const reportDir=path.join(dir,'reports');
  await review({window:{start,end,week:'2026-11-02'},
    dataDir:dir,reportDir,wahaKey:key,wahaFetcher:wahaMock,
    openaiKey:api,openaiFetcher:coachMock([])});
  const writes=[];
  const desk={dashboard:()=>({notes:[]}),addNote:value=>writes.push(value)};
  assert.equal(writes.length,0);
  const result=approveWeek('2026-11-02',{reportDir,desk});
  assert.equal(result.visibility,'TEAM');
  assert.equal(writes.length,1);
  assert.equal(writes[0].visibility,'TEAM');
  assert.match(writes[0].text,/cercanía/);
  assert.throws(()=>approveWeek('2026-11-02',{reportDir,desk}),/REPORT_NOT_APPROVABLE/);
});
test('WAHA 400 on list falls back to read-only overview and still studies chats',async t=>{
  const dir=fixture(t),requests=[];
  const fetcher=(url,opts)=>{
    requests.push(url);
    assert.equal(opts.method,'GET');
    if(url.includes('/chats?'))return Promise.resolve({
      ok:false,status:400,text:async()=>JSON.stringify({error:'Invalid sortBy'})
    });
    if(url.includes('/chats/overview?'))return Promise.resolve({
      ok:true,text:async()=>JSON.stringify(sampleChats)
    });
    return wahaMock(url,opts);
  };
  const result=await collectChats({key,from:start,dataDir:dir,fetcher});
  assert.equal(result.coverage.discovery,'WAHA_OVERVIEW');
  assert.equal(result.coverage.chatsWithMessages,2);
  assert.equal(result.coverage.discoveryError,null);
  assert.equal(result.coverage.partial,false);
  assert.ok(requests.some(x=>x.includes('/chats/overview?')));
});
test('when WEBJS does not list chats, local Inbox allows a clearly partial study',async t=>{
  const dir=fixture(t);
  const inbox=path.join(dir,'hommy-inbox');fs.mkdirSync(inbox);
  const event=(id,chatId,at,direction,text,other={})=>
    ({id,chatId,at,direction,text,source:direction==='OUTGOING'?'web':'',...other});
  fs.writeFileSync(path.join(inbox,'events.ndjson'),[
    event('event-1',customer,'2026-11-07T14:00:00Z','INCOMING',
      '¿Cuánto cuestan las cortinas?',
      {commercialOrigin:{campaign:'META',verified:true,sourceType:'ad'}}),
    event('event-2',customer,'2026-11-07T14:02:00Z','OUTGOING',
      'Hola, Laura, con gusto te orientamos. ¿Las buscas para sala o alcoba?'),
    event('group','120363123456789012@g.us','2026-11-07T14:01:00Z','INCOMING',
      'Hommy envía catalogo')
  ].map(JSON.stringify).join('\n'));
  let requests=0;
  const fail=async(url,opts)=>{
    requests++;
    assert.equal(opts.method,'GET');
    return {ok:false,status:400,text:async()=>JSON.stringify({error:'Not supported'})};
  };
  const result=await collectChats({key,from:start,dataDir:dir,fetcher:fail});
  assert.equal(result.coverage.discovery,'LOCAL_INBOX');
  assert.equal(result.coverage.partial,true);
  assert.equal(result.coverage.candidateChats,1);
  assert.equal(result.coverage.chatsFromInboxOnly,1);
  assert.equal(result.coverage.chatsWithMessages,1);
  assert.equal(result.conversations[0].metaKind,'META_AD');
  const stats=summaryOf(result.conversations);
  assert.equal(stats.incomingMessages,1);
  assert.equal(stats.outgoingMessages,1);
  assert.doesNotMatch(JSON.stringify(stats.excerpts),/Laura/);
  assert.ok(requests>=4);
});
test('GET requests strip personal chat IDs and WAHA response bodies from errors',async t=>{
  const dir=fixture(t);
  const mock=async()=>({ok:false,status:401,
    text:async()=>JSON.stringify({phone:'573001112233',token:'secret'})});
  const result=await collectChats({key,from:start,dataDir:dir,fetcher:mock});
  assert.equal(result.coverage.partial,true);
  assert.match(result.coverage.discoveryError,/WAHA_CHAT_LIST_HTTP_401/);
  assert.doesNotMatch(JSON.stringify(result.coverage),/573001112233|secret|token/);
});
test('missing WAHA key and failed network cannot manufacture study data',async t=>{
  const dir=fixture(t);
  await assert.rejects(()=>collectChats({key:'',base:'http://waha:3000',from:start}),/WAHA_KEY_UNAVAILABLE/);
  await assert.rejects(()=>collectChats({key,base:'https://evil.test',from:start}),/WAHA_BASE_INVALID/);
  const run=await review({window:{start,end,week:'2026-11-02'},
    reportDir:dir,dataDir:dir,wahaKey:key,wahaFetcher:async()=>({
      ok:true,text:async()=>JSON.stringify([])
    }),openaiKey:api,openaiFetcher:coachMock([])});
  assert.equal(run.coverage.chatsWithMessages,0);
  assert.equal(run.study.error,'NO_CONVERSATIONS_FOUND');
  assert.equal(run.approved,false);
});
test('safe report refuses to add incomplete or sensitive AI guidelines',async t=>{
  const dir=fixture(t);
  fs.writeFileSync(path.join(dir,'week-2026-11-02.json'),
    JSON.stringify({version:1,week:'2026-11-02',approved:false,
      study:{guidelines:['Llamar al cliente 573001112233.','Solo una regla.']}}));
  assert.throws(()=>approveWeek('2026-11-02',{reportDir:dir,
    desk:{dashboard:()=>({notes:[]}),addNote:()=>assert.fail('not safe')}}),/GUIDELINES_UNSAFE/);
});
