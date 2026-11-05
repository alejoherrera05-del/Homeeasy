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
  assert.match(preview('FOLLOWUP',[{status:'PENDIENTE'}],{a:['SEGUIMIENTO']},s),/1 clientes/);
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
