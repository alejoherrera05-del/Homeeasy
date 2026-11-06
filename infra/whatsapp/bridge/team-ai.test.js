'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {ReadableStream}=require('node:stream/web');
const {createTeamAI,readFacts,validateEndpoint,validateReply}=require('./team-ai');

const BACKEND='https://homeeasy-hommy-staging.onrender.com';
const ENDPOINT=BACKEND+'/api/hommy/team/interpret';
const KEY='a'.repeat(48);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-team-ai-'));
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 fs.mkdirSync(path.join(dir,'hommy-intelligence'));
 return dir;
}
function memory(root){
 fs.writeFileSync(path.join(root,'hommy-intelligence','state-v2.json'),JSON.stringify({
  version:2,clients:{c:{id:'c',name:'Claudia',phone:'573001234567'}},
  opportunities:{o:{status:'OPEN',clientId:'c',product:'Onda Serena',
   environments:['sala'],nextAction:'REQUEST_QUOTE_DETAILS',
   quoteNumbers:['HE-001'],summary:'Contacto privado 573001234567'},
  b:{status:'CLOSED',product:'Sheer Elegance',nextAction:'WAIT'}}
 }));
}
function response(body,status=200){
 const bodyText=JSON.stringify(body);
 return {status,body:new ReadableStream({start(c){c.enqueue(Buffer.from(bodyText));c.close();}})};
}
test('never enables without explicit flag, long service credential and trusted exact route',()=>{
 assert.equal(createTeamAI({enabled:false,endpoint:ENDPOINT,backendUrl:BACKEND,serviceToken:KEY}).available,false);
 assert.equal(createTeamAI({enabled:true,endpoint:ENDPOINT,backendUrl:BACKEND,serviceToken:'abc'}).available,false);
 assert.equal(validateEndpoint(ENDPOINT,BACKEND),ENDPOINT);
 for(const url of ['http://homeeasy-hommy-staging.onrender.com/api/hommy/team/interpret',
  'https://evil.example/api/hommy/team/interpret',
  BACKEND+'/api/hommy/chat',ENDPOINT+'?key=bad',ENDPOINT+'#fragment'])
   assert.equal(validateEndpoint(url,BACKEND),'',url);
});
test('facts contain verified scope without customer names, phone, text or secret quotes',t=>{
 const root=fixture(t);
 assert.equal(readFacts(root).available,false);
 memory(root);
 const facts=readFacts(root,2);
 assert.equal(facts.available,true);
 assert.equal(facts.knownClients,1);
 assert.equal(facts.openOpportunities,1);
 assert.equal(facts.manualPending,2);
 assert.deepEqual(facts.opportunities,[{
  product:'Onda Serena',rooms:['sala'],nextAction:'REQUEST_QUOTE_DETAILS',hasQuoteReference:true
 }]);
 assert.doesNotMatch(JSON.stringify(facts),/Claudia|573001234567|HE-001|Contacto privado/);
});
test('untrusted reply cannot claim a sent message, quote, phone number, URL or fabricated count',()=>{
 const data={question:'cómo va Onda Serena',facts:{knownClients:1,openOpportunities:1}};
 assert.equal(validateReply({kind:'ANSWER',text:'Tengo 3 clientes.'},data).kind,'UNAVAILABLE');
 assert.equal(validateReply({kind:'ANSWER',text:'Ya le envié la cotización.'},data).kind,'UNAVAILABLE');
 assert.equal(validateReply({kind:'ANSWER',text:'Cuesta $120000.'},data).kind,'UNAVAILABLE');
 assert.equal(validateReply({kind:'ANSWER',text:'Llama al 573001234567.'},data).kind,'UNAVAILABLE');
 assert.equal(validateReply({kind:'ANSWER',text:'Mira https://ejemplo.com'},data).kind,'UNAVAILABLE');
 assert.equal(validateReply({kind:'REVIEW_REQUIRED',text:'Listo, le escribí'},data).kind,'REVIEW_REQUIRED');
 assert.equal(validateReply({kind:'ANSWER',text:'Veo una oportunidad de Onda Serena. Aún faltan datos para cotizar.'},data).kind,'ANSWER');
});
test('authenticated read-only request includes sanitized scoped facts and 3-turn history',async t=>{
 const root=fixture(t);memory(root);
 let captured, options;
 const ai=createTeamAI({enabled:true,serviceToken:KEY,backendUrl:BACKEND,endpoint:ENDPOINT,
  dataDir:root,fetcher:async (url,opts)=>{
   captured=url;options=opts;
   return response({kind:'ANSWER',text:'Veo una oportunidad con Onda Serena. Falta información para cotizar.'});
  }});
 assert.equal(ai.available,true);
 const ans=await ai.interpret({question:'Cómo vamos con Onda Serena?',
  history:[{question:'Hola',answer:'Hola'},{question:'Qué sigue',answer:'Revisamos'},
  {question:'Y la visita?',answer:'Aún no está confirmada'},{question:'Y ahora',answer:'Vamos viendo'}],
  pendingTasks:0});
 assert.equal(ans.kind,'ANSWER');
 assert.equal(captured,ENDPOINT);
 assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
 assert.equal(options.headers.Authorization,'Bearer '+KEY);
 const sent=JSON.parse(options.body);
 assert.equal(sent.purpose,'HOME_EASY_TEAM_READ_ONLY');
 assert.equal(sent.history.length,3);
 assert.doesNotMatch(options.body,/Claudia|573001234567|HE-001|Contacto privado/);
 assert.deepEqual(sent.facts.opportunities[0].rooms,['sala']);
});
test('network and response errors fail closed, without fallback messages or retried sends',async()=>{
 const bad=createTeamAI({enabled:true,serviceToken:KEY,backendUrl:BACKEND,endpoint:ENDPOINT,
  fetcher:async()=>{throw Error('offline');}});
 assert.equal((await bad.interpret({question:'hola'})).kind,'UNAVAILABLE');
 const unavailable=createTeamAI({enabled:true,serviceToken:KEY,backendUrl:BACKEND,endpoint:ENDPOINT,
  fetcher:async()=>response({kind:'ANSWER',text:'Tiene 18 ofertas.'},503)});
 assert.equal((await unavailable.interpret({question:'hola'})).kind,'UNAVAILABLE');
});
