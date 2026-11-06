'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { classify, summarize, createOverview, preview } = require('./operational-overview');
const memory = () => ({version:2,clients:{a:{name:'Laura'},b:{name:'Andrés'}},opportunities:{
  x:{status:'OPEN',nextAction:'REQUEST_QUOTE_DETAILS',quoteNumbers:['HE-1']},
  y:{status:'OPEN',nextAction:'COLLECT_VISIT_DETAILS'},z:{status:'CLOSED',nextAction:'HUMAN_REVIEW'}
}});
test('classifies natural informational questions without promoting instructions to group sends', () => {
  for (const [q,type] of [['pendientes','PENDING'],['qué tenemos pendiente?','PENDING'],
    ['resumen comercial','SUMMARY'],['cotizaciones','QUOTES'],['visitas','VISITS'],
    ['seguimientos','FOLLOWUP'],['clientes','CLIENTS']]) assert.equal(classify(q),type,q);
  for (const q of ['cotizaciones y manda el PDF','visitas confirma para las 3',
    'pendientes dile a Laura que llegamos','clientes dame el teléfono de Laura'])
    assert.equal(classify(q),null,q);
});
test('counts only open analyzed opportunities without inventing confirmed events', () => {
  const s=summarize(memory());
  assert.deepEqual([s.clients,s.open,s.quotes,s.quoteDetails,s.visitDetails],[2,2,1,1,1]);
  assert.match(preview('PENDING',[],{},s),/solo cuento conversaciones analizadas/);
  assert.match(preview('VISITS',[],{},s),/no tengo una agenda confirmada/);
  assert.match(preview('QUOTES',[],{},s),/No puedo confirmar envíos ni valores/);
  assert.doesNotMatch(preview('SUMMARY',[],{},s),/Laura|Andrés/);
  assert.match(preview('FOLLOWUP',[{status:'PENDIENTE'}],{a:['SEGUIMIENTO']},s),/un cliente/);
});

test('client questions resolve only known product names or explicit exact-name inquiries', () => {
  const { parseClientQuery } = require('./operational-overview');
  for (const [q,kind,value] of [
    ['cliente Laura','NAME','laura'],
    ['qué sabemos de Laura?','NAME','laura'],
    ['qué pasó con el cliente de Onda Serena?','PRODUCT','Onda Serena'],
    ['cómo va lo de Sheer Elegance?','PRODUCT','Sheer Elegance'],
    ['cliente de la cortina Onda Serena','PRODUCT','Onda Serena'],
    ['estado de Panel Japonés','PRODUCT','Panel Japonés']
  ]) {
    const result = parseClientQuery(q);
    assert.equal(result.kind, kind, q);
    assert.equal(result.product || result.target, value, q);
  }
  for (const instruction of [
    'cliente de Onda Serena y mándale el precio',
    'que sabemos de Laura, llama a Laura',
    'cliente de Onda Serena manda cotización',
    'confirmar visita de Laura',
    'envía los datos de Laura'
  ]) assert.equal(parseClientQuery(instruction), null, instruction);
});

test('client memory lookup uses exact identity, ambiguity stops, excludes private numbers', t => {
  const { clientReport, parseClientQuery, createClientLookup } = require('./operational-overview');
  const state = { version:2, clients:{
    a:{id:'a',name:'Laura',provisional:false,identityConflicts:[],phones:['573001112233']},
    b:{id:'b',name:'Andrés',provisional:true,phones:['573008888888']}
  }, opportunities: {
    one:{id:'one',clientId:'a',product:'Onda Serena',status:'OPEN',
      nextAction:'COLLECT_VISIT_DETAILS',environments:['sala'],quoteNumbers:['HE123']},
    two:{id:'two',clientId:'b',product:'Sheer Elegance',status:'OPEN',
      nextAction:'REQUEST_QUOTE_DETAILS',environments:['habitación'],quoteNumbers:[]}
  }};
  const products=clientReport(state,parseClientQuery('cliente de Onda Serena'));
  assert.match(products,/Laura/);
  assert.match(products,/Onda Serena/);
  assert.match(products,/Falta completar información de la visita; no está confirmada/);
  assert.match(products,/referencia de cotización, pero no puedo confirmar/);
  assert.doesNotMatch(products,/573001112233|HE123/);
  state.opportunities.one.environments=['sala - 573001112233'];
  assert.doesNotMatch(clientReport(state,parseClientQuery('cliente de Onda Serena')),/573001112233|Espacio:/);
  state.opportunities.one.environments=['sala'];
  state.clients.a.name='Laura 573001112233';
  assert.doesNotMatch(clientReport(state,parseClientQuery('cliente de Onda Serena')),/573001112233/);
  state.clients.a.name='Laura';
  const name=clientReport(state,parseClientQuery('qué sabemos de Andrés'));
  assert.match(name,/Sheer Elegance/);
  assert.match(name,/Faltan datos para preparar una cotización/);
  assert.doesNotMatch(name,/573008888888/);
  assert.match(clientReport(state,parseClientQuery('cliente Luis')), /No encuentro ese nombre exacto/);
  state.opportunities.three={...state.opportunities.one,id:'three',clientId:'b'};
  assert.match(clientReport(state,parseClientQuery('cómo va lo de Onda Serena')), /2 oportunidades/);
  state.clients.c={id:'c',name:'Laura',provisional:false};
  assert.match(clientReport(state,parseClientQuery('cliente Laura')), /más de un cliente/);

  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-client-lookup-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const mem=path.join(dir,'hommy-intelligence');fs.mkdirSync(mem);
  const file=path.join(mem,'state-v2.json');
  const lookup=createClientLookup(dir);
  assert.match(lookup('cliente Laura'),/No pude consultar/);
  fs.writeFileSync(file,JSON.stringify(state));
  assert.match(lookup('cliente Laura'),/más de un cliente/);
  assert.equal(lookup('cliente Laura y avísale'),null);
  fs.writeFileSync(file+'.tmp','{invalid');
  fs.renameSync(file+'.tmp',file);
  assert.match(lookup('cliente Laura'),/No pude consultar/);
});

test('reads the local snapshot lazily, refreshes after atomic write and fails closed', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-overview-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'hommy-intelligence'); fs.mkdirSync(dir);
  const file=path.join(dir,'state-v2.json'),read=createOverview(root);
  assert.equal(read().available,false);
  fs.writeFileSync(file,JSON.stringify(memory()));
  assert.equal(read().clients,2);
  const updated=memory();updated.clients.c={name:'Tercera'};
  fs.writeFileSync(file+'.tmp',JSON.stringify(updated));fs.renameSync(file+'.tmp',file);
  assert.equal(read().clients,3);
  fs.writeFileSync(file+'.tmp','{invalid');fs.renameSync(file+'.tmp',file);
  assert.equal(read().available,false);
  assert.match(preview('PENDING',[],{},read()),/No pude consultar/);
});
