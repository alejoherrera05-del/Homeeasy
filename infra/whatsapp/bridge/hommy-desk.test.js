'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const {createHommyDesk,CATALOG_NAME,PRODUCT_FACTS,wantsCustomerCatalog}=require('./hommy-desk');

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


test('Bridge web desk contracts require authenticated permissions and do not add customer auto sends',()=>{
  const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  const updater=fs.readFileSync(path.join(__dirname,'..','update-bridge.sh'),'utf8');
  const dockerfile=fs.readFileSync(path.join(__dirname,'Dockerfile'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'..','..','..','homeeasy-hommy-operations-ui.js'),'utf8');
  assert.match(server,/const hommyDesk = createHommyDesk/);
  for(const route of [
    '/api/whatsapp/hommy/desk',
    '/api/whatsapp/hommy/desk/catalog',
    '/api/whatsapp/hommy/desk/notes',
    '/api/whatsapp/hommy/desk/notes/edit',
    '/api/whatsapp/hommy/desk/notes/archive'
  ]) assert.ok(server.includes(route),route);
  assert.match(server,/const actor = await auth\.authorize\(req, 'config\.write'\);[\s\S]*?hommyDesk\.installCatalog/);
  assert.match(server,/hommyWorkspace\.reserveTeamCatalog\(group\.id\)/);
  assert.match(server,/chatId: reservedCatalog\.groupId/);
  assert.doesNotMatch(server,/chatId:\s*.*(?:customer|record\.chatId).*catalog/i);
  assert.match(updater,/hommy-desk\.js/);
  assert.match(dockerfile,/COPY hommy-desk\.js \.\//);
  assert.match(updater,/hommy-desk\.tar\.gz/);
  assert.match(ui,/Escritorio y memoria/);
});


test('catalog automation stays off until explicitly enabled with a real PDF',t=>{
  const {root,desk}=setup(t);
  assert.equal(desk.customerCatalogEnabled(),false);
  assert.throws(()=>desk.setCustomerCatalogAutomation(true),
    e=>e.code==='HOMMY_CATALOG_REQUIRED');
  desk.installCatalog(fakePdf());
  assert.equal(desk.customerCatalogEnabled(),false);
  desk.setCustomerCatalogAutomation(true,{profile:{uid:'owner'}});
  assert.equal(desk.customerCatalogEnabled(),true);
  assert.equal(createHommyDesk({dataDir:root}).customerCatalogEnabled(),true);
  desk.setCustomerCatalogAutomation(false);
  assert.equal(desk.customerCatalogEnabled(),false);
});
test('customer catalog classifier allows only explicit, single-purpose requests',()=>{
  for(const text of [
    'Hola, ¿me puedes enviar el catálogo?',
    '¿Me compartes el catálogo de HomeEasy?',
    'Me mandas el catálogo por favor?',
    'Quiero ver catálogo',
    'Necesito el catálogo de persianas y cortinas',
    'Tienen catálogo?'
  ]) assert.equal(wantsCustomerCatalog(text),true,text);
  for(const text of [
    'No me envíes el catálogo',
    'No me manden el catálogo',
    'Catálogo y cotización',
    'Me pasas el catálogo y me das un descuento?',
    'Cuánto cuestan las cortinas?',
    '¿Dónde están ubicados?',
    'Hommy envía el catálogo a Laura',
    'Hola, quiero pagar por la instalación'
  ]) assert.equal(wantsCustomerCatalog(text),false,text);
});
test('automatic catalog sending is isolated behind authenticated inbox and human takeover checks',()=>{
  const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  const source=server.slice(server.indexOf('async function maybeSendCustomerCatalog('),
    server.indexOf('async function handle(req, res)'));
  assert.match(source,/hommyDesk\.customerCatalogEnabled\(\)/);
  assert.match(source,/hommyWorkspace\.status\(\)\.mode !== 'REVIEW'/);
  assert.match(source,/wantsCustomerCatalog\(record\.text\)/);
  assert.match(source,/wahaRequest\('GET'/);
  assert.match(source,/OUTGOING/);
  assert.match(source,/persistIdempotency\(\)/);
  assert.match(source,/chatId:record\.chatId/);
  assert.match(server,/hommyInbox\.ingest\(raw, req\.headers\); \/\/ HMAC and session verified first/);
  assert.match(server,/if \(result\.accepted && hommyDesk\.customerCatalogEnabled\(\)\)/);
});
