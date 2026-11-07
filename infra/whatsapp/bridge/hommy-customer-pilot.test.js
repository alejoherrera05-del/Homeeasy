'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  chatIdOf,unreadOf,allowConversation,draftReply,validateDraft,askedAboutAutomation,
  listCandidates,sendOnce,sanitizedForModel,firstObservedReply,isSendConfirmation,
  commercialQuestion,unsupportedProductClaim,isMetaAdAutoGreeting,
  withoutMetaAdAutoGreetings
}=require('./hommy-customer-pilot');

const CUSTOMER='573001112233@c.us',GROUP='120363123456789012@g.us';
const CONF={url:'http://waha:3000/api/homeeasy/',session:'homeeasy',key:'test-waha-key'};
const KEY='sk-'+'a'.repeat(45);
const now=Math.floor(Date.now()/1000);
function temp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-one-client-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function record(id,time,fromMe,body){
  return {id,fromMe,body,timestamp:time};
}
function wahaList(url,opts){
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers['X-Api-Key'],CONF.key);
  const arr=[
    {id:CUSTOMER,name:'Cliente seleccionada',unreadCount:-1},
    {id:GROUP,name:'Grupo',unreadCount:2},
    {id:'573001112244@c.us',name:'Otra',unreadCount:0}
  ];
  return Promise.resolve({ok:true,text:async()=>JSON.stringify(arr)});
}
test('explicit send confirmation accepts case variants but not accidental text',()=>{
  for(const consent of ['enviar','Enviar','ENVIAR','  enviar  ',' EnViAr '])
    assert.equal(isSendConfirmation(consent),true,consent);
  for(const consent of ['', 'si', '1','enviar ahora','enviar porfa','enviarlo','cancelar'])
    assert.equal(isSendConfirmation(consent),false,consent);
});
test('gender-neutral welcome is used even if model assumes client gender',()=>{
  const draft=validateDraft({kind:'DRAFT',
    text:'Hola 😊 Bienvenido a HomeEasy, soy Hommy. Con gusto te ayudo con tu cotización. Para qué espacio la necesitas?'
  },{firstReply:true});
  assert.equal(draft.ok,true);
  assert.match(draft.text,/Te damos la bienvenida a HomeEasy/);
  assert.doesNotMatch(draft.text,/Bienvenido a HomeEasy|[¡¿]/);
  const female=validateDraft({kind:'DRAFT',
    text:'Hola 😊 Bienvenida a HomeEasy, soy Hommy. Con gusto te ayudamos con tu cotización. Para sala o habitación?'
  },{firstReply:true});
  assert.equal(female.ok,true);
  assert.match(female.text,/Te damos la bienvenida a HomeEasy/);
});

// The Meta ad uses WhatsApp's "Saludo automático", not a human-authored
// reply or WhatsApp Business' separate welcome-message setting.
const META_AD_WELCOME='👋 ¡Te damos la bienvenida a HomeEasy! 🎉 Transformamos tus espacios con persianas y papel de colgadura diseñados para dar estilo, privacidad y funcionalidad ✨ 🎁 Este mes puedes aprovechar hasta 30% de descuento en referencias seleccionadas para renovar tu hogar con elegancia 🏡';
function adConversation(at=Date.now()-20000){
  return [
    {id:'lead',at:new Date(at).toISOString(),direction:'INCOMING',
      text:'Hola buena tarde',hasMedia:false},
    {id:'meta',at:new Date(at+1000).toISOString(),direction:'OUTGOING',
      text:META_AD_WELCOME,hasMedia:false}
  ];
}
test('Meta ad automatic welcome is ignored as takeover but not as customer text',()=>{
  const rows=adConversation();
  assert.equal(isMetaAdAutoGreeting(rows[0],rows[1]),true);
  assert.equal(allowConversation(rows).ok,true);
  assert.equal(allowConversation(rows).last.id,'lead');
  assert.equal(allowConversation(rows).metaAdGreetingIgnored,true);
  assert.equal(firstObservedReply(rows),true);
  assert.deepEqual(withoutMetaAdAutoGreetings(rows),[rows[0]]);
});
test('human reply, generic welcome and delayed ad copy still block Hommy',()=>{
  const rows=adConversation();
  assert.equal(allowConversation([...rows,{
    id:'human',at:new Date(Date.now()-17000).toISOString(),
    direction:'OUTGOING',text:'Hola, ya estoy revisando tu solicitud'
  }]).reason,'LAST_MESSAGE_NOT_CUSTOMER');
  assert.equal(allowConversation([rows[0],{...rows[1],
    text:'Hola, soy la asesora. Te damos la bienvenida a HomeEasy'
  }]).reason,'LAST_MESSAGE_NOT_CUSTOMER');
  assert.equal(allowConversation([rows[0],{...rows[1],
    at:new Date(Date.parse(rows[0].at)+30000).toISOString()
  }]).reason,'LAST_MESSAGE_NOT_CUSTOMER');
  assert.equal(allowConversation([rows[0],{...rows[1],
    text:META_AD_WELCOME.replace('30%','20%')
  }]).reason,'LAST_MESSAGE_NOT_CUSTOMER');
});
test('Meta ad greeting is removed from model context but the real lead remains',async()=>{
  let req;
  const fetcher=async(_url,request)=>{
    req=JSON.parse(request.body);
    return {ok:true,json:async()=>({status:'completed',output:[{
      content:[{type:'output_text',text:JSON.stringify({
        kind:'DRAFT',text:'Hola 😊 Soy Hommy, de HomeEasy. Gracias por escribirnos. En qué puedo ayudarte?'
      })}]
    }]})};
  };
  const reply=await draftReply(adConversation(),{apiKey:KEY,fetcher,style:[]});
  assert.equal(reply.ok,true);
  const context=JSON.parse(req.input[1].content);
  assert.equal(context.firstObservedReply,true);
  assert.equal(context.metaAdAutoGreetingObserved,true);
  assert.deepEqual(context.conversation.map(x=>x.direction),['INCOMING']);
  assert.match(context.conversation[0].text,/Hola buena tarde/);
  assert.doesNotMatch(JSON.stringify(context.conversation),/30%|Transformamos tus espacios/);
});
test('sendOnce still rechecks the Meta greeting and sends once to the LID chat',async t=>{
  const dir=temp(t),lid='123456789012345@lid',sent=[];
  const messages=[record('lead',now-8,false,'Hola buena tarde'),
    record('meta',now-7,true,META_AD_WELCOME)];
  const fetcher=async(_url,request)=>{
    if(request.method==='GET')
      return {ok:true,text:async()=>JSON.stringify(messages)};
    sent.push(JSON.parse(request.body));
    return {ok:true,status:200};
  };
  const result=await sendOnce(CONF,lid,'lead',
    'Hola 😊 Soy Hommy, de HomeEasy. En qué puedo ayudarte?',
    {fetcher,claimDir:dir});
  assert.equal(result.status,'SENT');
  assert.equal(sent.length,1);
  assert.equal(sent[0].chatId,lid);
});
test('manual unread count -1 is eligible, but groups and ordinary reads are excluded',async()=>{
  assert.equal(unreadOf({unreadCount:-1}),true);
  assert.equal(unreadOf({unreadCount:1}),true);
  assert.equal(unreadOf({unreadCount:0}),false);
  assert.equal(chatIdOf({id:GROUP}),'');
  const result=await listCandidates(CONF,wahaList);
  assert.equal(result.visibleUnread,true);
  assert.equal(result.unreadCount,1);
  assert.equal(result.items.length,1);
  assert.equal(chatIdOf(result.items[0]),CUSTOMER);
});
test('a mark-as-unread is not itself an inbound message: no auto send',()=>{
  const rows=[{id:'msg-1',direction:'INCOMING',at:new Date().toISOString(),
      text:'Quiero cotizar',hasMedia:false},
    {id:'msg-2',direction:'OUTGOING',at:new Date().toISOString(),
      text:'Claro, ¿qué necesitas?',hasMedia:false}];
  assert.equal(allowConversation(rows).reason,'LAST_MESSAGE_NOT_CUSTOMER');
  assert.equal(allowConversation(rows.slice(0,1)).ok,true);
});
test('sensitive, media and older conversations are left to a human',()=>{
  const at=new Date().toISOString();
  for(const text of ['Quiero hacer un reclamo','¿Puedo hacer un pago?',
    'Devolución de mi compra','No me contacten más']){
    assert.equal(allowConversation([{id:'x',at,direction:'INCOMING',text}]).reason,
      'HUMAN_REVIEW_REQUIRED',text);
  }
  assert.equal(allowConversation([{id:'x',at,direction:'INCOMING',
    text:'[Audio]',hasMedia:true}]).reason,'MESSAGE_NOT_TEXT');
  assert.equal(allowConversation([{id:'x',at:'2025-04-01T00:00:00Z',
    direction:'INCOMING',text:'Hola'}]).reason,'MESSAGE_OUTSIDE_7_DAYS');
});
test('a Meta ad price quick reply provides intent, NOT evidence of Onda Serena',async()=>{
  const rows=[{direction:'INCOMING',text:'2️⃣ Cotización y precios'}];
  const commercial=commercialQuestion(rows);
  assert.equal(commercial.kind,'UNSPECIFIED_PRODUCT');
  assert.deepEqual(commercial.productFacts,[]);
  assert.equal(unsupportedProductClaim(
    'Hola 😊 Soy Hommy, de HomeEasy. Te ayudo con Onda Serena. Qué necesitas?',
    commercial),true);
  assert.equal(unsupportedProductClaim(
    'Hola 😊 Soy Hommy, de HomeEasy. Te ayudo con tu cotización. Qué tipo de persiana te interesa?',
    commercial),false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'Hola 😊 Soy Hommy, de HomeEasy. Con gusto te ayudo a cotizar nuestra Onda Serena. Qué buscas?'},
    {firstReply:true,commercial}).ok,false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'Hola 😊 Soy Hommy, de HomeEasy. Con gusto te ayudo con tu cotización. Qué persiana buscas?'},
    {firstReply:true,commercial}).ok,true);
});
test('explicit customer product or request for options permits grounded product descriptions',()=>{
  const named=commercialQuestion([{direction:'INCOMING',text:'Me interesa Onda Serena'}]);
  assert.equal(named.kind,'SPECIFIC_PRODUCT');
  assert.equal(named.productFacts.length,2);
  assert.equal(unsupportedProductClaim('Nuestra Onda Serena Velo filtra la luz.',named),false);
  assert.equal(unsupportedProductClaim('Te recomiendo un panel japonés.',named),true);
  const types=commercialQuestion([{direction:'INCOMING',
    text:'3️⃣ Tipos de persianas disponibles'}]);
  assert.equal(types.kind,'PRODUCT_OPTIONS');
  assert.ok(types.productFacts.length>=5);
  assert.equal(unsupportedProductClaim('Tenemos Sheer Elegance y panel japonés.',types),false);
});
test('model sees no product names for a generic quote and unsupported suggestions are blocked',async()=>{
  let request;
  const fake=async(_url,options)=>{
    request=JSON.parse(options.body);
    return {ok:true,json:async()=>({
      status:'completed',output:[{type:'message',content:[{type:'output_text',
        text:JSON.stringify({kind:'DRAFT',text:
          'Hola 😊 Soy Hommy, de HomeEasy. Te recomiendo Onda Serena para tu cotización. Qué espacio es?'})
      }]}]
    })};
  };
  const result=await draftReply([{direction:'INCOMING',text:'Para cotizar'}],
    {apiKey:KEY,style:[],fetcher:fake});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'DRAFT_FAILED_SAFETY_CHECK');
  const user=JSON.parse(request.input[1].content);
  assert.equal(user.commercialIntent,'UNSPECIFIED_PRODUCT');
  assert.deepEqual(user.productFacts,[]);
  assert.doesNotMatch(JSON.stringify(user),/Onda Serena|Sheer Elegance|Panel Japonés/);
});
test('private phone/email/address are removed before one-chat OpenAI request',async()=>{
  assert.doesNotMatch(sanitizedForModel('Escribe al +57 300 123 4567 y a ana@test.co'),
    /300 123|ana@test/);
  let body;
  const fetcher=async(url,req)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.match(req.headers.Authorization,/^Bearer sk-/);
    body=JSON.parse(req.body);
    return {ok:true,json:async()=>({
      status:'completed',
      output:[{type:'message',content:[{type:'output_text',
        text:JSON.stringify({kind:'DRAFT',
          text:'¡Hola! 😊 Qué gusto saludarte. Soy Hommy, de HomeEasy. Con mucho gusto te ayudo a cotizar. ¿La persiana es para sala o habitación?'})
      }]}]
    })};
  };
  const result=await draftReply([
    {direction:'INCOMING',text:'Hola, quiero precio. Llámame al +57 300 123 4567'}
  ],{apiKey:KEY,style:['Conocer la intención comercial antes de hacer preguntas.'],
    fetcher});
  assert.equal(result.ok,true);
  assert.equal(body.store,false);
  assert.equal(body.tools,undefined);
  assert.equal(body.input[0].role,'system');
  assert.match(body.input[0].content,/Si firstObservedReply=true, comienza SIEMPRE/);
  assert.match(body.input[0].content,/Si el cliente pregunta quién contesta/);
  assert.equal(JSON.parse(body.input[1].content).firstObservedReply,true);
  assert.equal(result.text.includes('asistente virtual'),false);
  assert.equal(result.text.includes('¡'),false);
  assert.equal(result.text.includes('¿'),false);
  assert.equal(body.input[1].role,'user');
  assert.doesNotMatch(body.input[1].content,/300 123 4567|@c.us|sk-aaaa/);
  assert.match(body.input[1].content,/Conocer la intención/);
  assert.equal(body.model,'gpt-5.4-mini');
});
test('a concise HomeEasy greeting is allowed without claiming to be human',()=>{
  assert.equal(validateDraft({kind:'DRAFT',
    text:'¡Hola! 😊 Con gusto te ayudamos a cotizar. ¿La persiana es para sala o habitación?'}).ok,true);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'Soy una persona real de HomeEasy, cuéntame qué te hace falta.'}).ok,false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'¡Hola! Soy Hommy, un asistente automatizado de HomeEasy. ¿Cómo te ayudo?'}).ok,false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'¡Hola! Soy Hommy, un asistente automatizado de HomeEasy. ¿Cómo te ayudo?'},
    {allowDisclosure:true}).ok,true);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'¡Hola! Soy Hommy, de HomeEasy. Con gusto te ayudamos con tu consulta.'},
    {firstReply:true}).ok,true);
  assert.equal(askedAboutAutomation([{direction:'INCOMING',
    text:'¿Eres un bot o te atiende una persona?'}]),true);
  assert.equal(askedAboutAutomation([{direction:'INCOMING',
    text:'Quiero cotizar una persiana para mi sala.'}]),false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'Soy Hommy, el asistente de HomeEasy. El precio de la persiana es 500 mil pesos.'}).ok,false);
});

test('WhatsApp messages automatically omit inverted punctuation, preserving welcome and punctuation',()=>{
  const first=validateDraft({
    kind:'DRAFT',
    text:'¡Hola! 😊 Qué gusto saludarte, soy Hommy de HomeEasy. ¿La persiana es para sala o habitación?'
  },{firstReply:true});
  assert.equal(first.ok,true);
  assert.equal(first.text,'Hola! 😊 Qué gusto saludarte, soy Hommy de HomeEasy. La persiana es para sala o habitación?');
  assert.doesNotMatch(first.text,/[¡¿]/);
  const next=validateDraft({kind:'DRAFT',
    text:'¡Claro! ¿Buscas más luz o privacidad para la sala?'
  },{firstReply:false});
  assert.equal(next.ok,true);
  assert.equal(next.text,'Claro! Buscas más luz o privacidad para la sala?');
  const blocked=validateDraft({kind:'DRAFT',
    text:'¡Hola! ¿Qué valor buscas? Te saluda una persona real de HomeEasy.'
  },{firstReply:false});
  assert.equal(blocked.ok,false);
});

test('first observed reply must greet, name Hommy and introduce HomeEasy',()=>{
  assert.equal(firstObservedReply([{
    direction:'INCOMING',text:'2️⃣ Cotización y precios'
  }]),true);
  assert.equal(firstObservedReply([
    {direction:'OUTGOING',text:'¡Hola! Gracias por escribirnos.'},
    {direction:'INCOMING',text:'¿Qué opciones tienen?'}
  ]),false);
  const valid='¡Hola! 😊 Te damos la bienvenida a HomeEasy. Soy Hommy. ¿La buscas para sala o habitación?';
  assert.equal(validateDraft({kind:'DRAFT',text:valid},{firstReply:true}).ok,true);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'¡Claro! Con gusto te ayudamos. ¿Es para sala o habitación?'},
    {firstReply:true}).ok,false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'¡Hola! Con gusto te ayudamos con las persianas. ¿Las necesitas para sala?'},
    {firstReply:true}).ok,false);
  assert.equal(validateDraft({kind:'DRAFT',
    text:'Te saluda Hommy, de HomeEasy. ¿Necesitas para la sala o habitación?'},
    {firstReply:true}).ok,false);
  // A new full introduction should not be repeated in an existing conversation.
  assert.equal(validateDraft({kind:'DRAFT',text:valid},
    {firstReply:false}).ok,false);
});
test('follow-up prompt understands existing replies and avoids repeating presentation',async()=>{
  let data;
  const fetcher=async(_url,request)=>{
    data=JSON.parse(request.body);
    return {ok:true,json:async()=>({status:'completed',output:[{
      type:'message',content:[{type:'output_text',text:JSON.stringify({
        kind:'DRAFT',text:'Para la sala, una opción muy linda es Onda Serena Velo. ¿Prefieres luz suave o más privacidad?'
      })}]
    }]})};
  };
  const result=await draftReply([
    {direction:'OUTGOING',text:'Hola, soy Hommy, de HomeEasy.'},
    {direction:'INCOMING',text:'¿Qué me recomiendas para la sala?'}
  ],{apiKey:KEY,fetcher,style:[]});
  assert.equal(JSON.parse(data.input[1].content).firstObservedReply,false);
  assert.equal(result.ok,true);
  assert.doesNotMatch(result.text,/hola|hommy/i);
});

test('unsafe draft or request for money is never sent',()=>{
  for(const text of ['Ya le confirmé la visita de mañana.',
    'El valor es $500.000', 'Consulta https://example.com precios',
    'Te llamamos al +57 300 123 4567']){
    assert.equal(validateDraft({kind:'DRAFT',text}).ok,false,text);
  }
  assert.equal(validateDraft({kind:'REVIEW_REQUIRED',text:''}).ok,false);
});
test('exactly one outbound send; reservation blocks retries after the same inbound',async t=>{
  const dir=temp(t),seen=[];
  const arr=[record('incoming-id',now,false,'2️⃣ Cotización y precios')];
  const fetcher=async(url,opts)=>{
    if(opts.method==='GET'){
      assert.match(url,/messages\?/);
      return {ok:true,text:async()=>JSON.stringify(arr)};
    }
    seen.push({url,body:JSON.parse(opts.body)});
    return {ok:true,status:200};
  };
  const msg='¡Hola! Soy Hommy, el asistente virtual de HomeEasy. ¿Buscas persianas para sala o alcoba?';
  const sent=await sendOnce(CONF,CUSTOMER,'incoming-id',msg,{fetcher,claimDir:dir});
  assert.equal(sent.status,'SENT');
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'http://waha:3000/api/sendText');
  assert.equal(seen[0].body.chatId,CUSTOMER);
  assert.equal(seen[0].body.text,msg);
  assert.match(fs.readdirSync(dir)[0],/^[a-f0-9]{64}\.json$/);
  const records=fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0]),'utf8');
  assert.doesNotMatch(records,/573001112233|Cotización y precios/);
  await assert.rejects(()=>sendOnce(CONF,CUSTOMER,'incoming-id',msg,{fetcher,claimDir:dir}),
    e=>e.code==='EEXIST');
  assert.equal(seen.length,1);
});
test('an outgoing human reply or a newer incoming message aborts sending',async t=>{
  const dir=temp(t);
  const arr=[
    record('incoming-id',now-60,false,'Quiero cotizar'),
    record('human-id',now,true,'Claro, te cuento')
  ];
  const fetcher=async()=>({ok:true,text:async()=>JSON.stringify(arr)});
  await assert.rejects(()=>sendOnce(CONF,CUSTOMER,'incoming-id',
    '¡Hola! Soy Hommy, el asistente virtual de HomeEasy.',{fetcher,claimDir:dir}),
    /CHAT_CHANGED_SEND_ABORTED/);
  assert.equal(fs.readdirSync(dir).length,0);
});
test('emergency stop is checked before a WAHA send even after a draft exists',async t=>{
  const dir=temp(t);
  let posts=0;
  const request=async(_url,opts)=>{
    if(opts.method==='GET')return {ok:true,text:async()=>JSON.stringify([
      record('new-in',now,false,'Quiero cotizar')])};
    posts++;
    return {ok:true,status:200};
  };
  await assert.rejects(()=>sendOnce(CONF,CUSTOMER,'new-in',
    'Hola 😊 Soy Hommy, de HomeEasy. Qué producto te interesa cotizar?',
    {fetcher:request,claimDir:dir,canSend:()=>false}),/AUTOMATION_DISABLED/);
  assert.equal(posts,0);
  assert.equal(fs.readdirSync(dir).length,0);
});
test('a network failure during send becomes UNKNOWN, not an automatic retry',async t=>{
  const dir=temp(t);
  let sends=0;
  const fetcher=async(url,opts)=>{
    if(opts.method==='GET')
      return {ok:true,text:async()=>JSON.stringify([record('last',now,false,'Quiero cotizar')])};
    sends++;
    throw Error('WAHA socket timeout after sending');
  };
  await assert.rejects(()=>sendOnce(CONF,CUSTOMER,'last',
    '¡Hola! Soy Hommy, asistente virtual de HomeEasy. ¿Qué espacio quieres cotizar?',
    {fetcher,claimDir:dir}),/WAHA_SEND_STATUS_UNKNOWN/);
  assert.equal(sends,1);
  const state=JSON.parse(fs.readFileSync(path.join(dir,fs.readdirSync(dir)[0])));
  assert.equal(state.state,'UNKNOWN');
  await assert.rejects(()=>sendOnce(CONF,CUSTOMER,'last','Otra respuesta',{fetcher,claimDir:dir}),
    e=>e.code==='EEXIST');
  assert.equal(sends,1);
});
