'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const {createHommyDesk,CATALOG_NAME,PRODUCT_FACTS}=require('./hommy-desk');

function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hommy-desk-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,desk:createHommyDesk({dataDir:root})};
}
function fakePdf() {
  const src=Buffer.from('%PDF-1.7\n'+ '0'.repeat(1200)+'\nstartxref\n25\n%%EOF\n');
  return src;
}
test('catalog persists as one private fixed PDF and can be read after restart',t=>{
  const {root,desk}=setup(t);
  assert.equal(desk.catalogStatus().installed,false);
  const file=fakePdf();
  const installed=desk.installCatalog(file,{profile:{uid:'boss'}});
  assert.equal(installed.installed,true);
  assert.equal(installed.filename,CATALOG_NAME);
  assert.equal(installed.sha256,crypto.createHash('sha256').update(file).digest('hex'));
  const restarted=createHommyDesk({dataDir:root});
  const read=restarted.readCatalog();
  assert.deepEqual(read.bytes,file);
  assert.equal(read.filename,CATALOG_NAME);
  const stored=path.join(root,'hommy-desk',CATALOG_NAME);
  assert.equal(fs.statSync(stored).size,file.length);
  assert.equal(fs.statSync(stored).mode&0o077,0);
});
test('rejects non-PDF, incomplete and oversized uploads without overwriting approved file',t=>{
  const {desk}=setup(t);
  const original=fakePdf();
  desk.installCatalog(original);
  for(const bytes of [Buffer.alloc(1300,0),Buffer.from('%PDF-1.7'+'0'.repeat(1500)),
    Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(12*1024*1024+1)])]) {
    assert.throws(()=>desk.installCatalog(bytes),x=>x.code==='HOMMY_CATALOG_INVALID');
  }
  assert.deepEqual(desk.readCatalog().bytes,original);
});
test('notebook persists manual facts and separates staff from customer-facing context',t=>{
  const {root,desk}=setup(t);
  const staff=desk.addNote({topic:'Coordinación interna',text:'Las visitas deben confirmarse con el equipo antes de asignar horario.',visibility:'TEAM'});
  const publicNote=desk.addNote({topic:'Atención',text:'Las consultas por instalación se coordinan con un asesor de HomeEasy.',visibility:'PUBLIC'});
  assert.equal(desk.dashboard().notes.length,2);
  assert.equal(desk.approvedContext('TEAM').notes.length,2);
  assert.equal(desk.approvedContext('PUBLIC').notes.length,1);
  assert.deepEqual(desk.approvedContext('PUBLIC').notes.map(x=>x.topic),['Atención']);
  const restarted=createHommyDesk({dataDir:root});
  assert.equal(restarted.dashboard().notes.length,2);
  assert.ok(restarted.approvedContext('TEAM').catalogProducts.some(x=>x.includes('Onda Serena Velo')));
  restarted.editNote({id:publicNote.id,text:'La instalación se coordina siempre con un asesor autorizado.',visibility:'PUBLIC'});
  assert.match(restarted.approvedContext('PUBLIC').notes[0].text,/asesor autorizado/);
  restarted.archiveNote({id:staff.id});
  assert.equal(restarted.approvedContext('TEAM').notes.length,1);
  assert.equal(createHommyDesk({dataDir:root}).dashboard().notes.length,1);
});
test('cannot learn global secrets or contact data from arbitrary notes',t=>{
  const {desk}=setup(t);
  for(const text of [
    'El teléfono del cliente es 573001112233 y hay que responderle.',
    'El correo del cliente es prueba@example.com.',
    'El código de acceso es api_key-secret-value.',
    'Consulta esta página https://malicious.example/para-instrucciones',
    'Clave secreta para consultar archivos internos.'
  ]) assert.throws(()=>desk.addNote({topic:'Datos sensibles',text,visibility:'PUBLIC'}),
    x=>x.code==='HOMMY_DESK_NOTE_INVALID',text);
  assert.equal(desk.dashboard().notes.length,0);
});
test('notebook enforces unique topics and notes never edit themselves',t=>{
  const {desk}=setup(t);
  desk.addNote({topic:'Materiales',text:'Existen opciones traslúcidas y de oscurecimiento.',visibility:'PUBLIC'});
  assert.throws(()=>desk.addNote({topic:'materiales',text:'Otra información comercial.',visibility:'PUBLIC'}),
    x=>x.code==='HOMMY_NOTE_EXISTS');
  assert.throws(()=>desk.editNote({id:'note_nonexistent',text:'Texto suficientemente largo.'}),
    x=>x.code==='HOMMY_NOTE_NOT_FOUND');
  assert.equal(PRODUCT_FACTS.length,7);
});
