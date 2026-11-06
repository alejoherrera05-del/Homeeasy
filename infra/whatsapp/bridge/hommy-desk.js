'use strict';

// Hommy's durable, human-approved desk. The file belongs to the Bridge's
// mounted DATA_DIR and never to a source-code checkout or temporary container.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_NAME = 'CATALOGO_HOMEEASY_OFICIAL_WHATSAPP.pdf';
const CATALOG_MAX_BYTES = 12 * 1024 * 1024;
const MAX_NOTES = 100;
const trim = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
const fail = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const normal = value => trim(value, 300).normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');

const PRODUCT_FACTS = Object.freeze([
  'Sheer Elegance: persiana de doble tejido horizontal traslúcido y opaco; permite graduar la luz sin subirla por completo; admite motorización.',
  'Sheer Vertesse: sistema de lamas verticales de tela con giro de 180 grados; controla luz y privacidad; útil en ventanales grandes.',
  'Panel Japonés: paneles deslizantes para ventanales y puertas corredizas; permite controlar luz y privacidad.',
  'Enrollable Screen: tejido que filtra los rayos solares y mantiene visibilidad al exterior; contribuye al confort térmico.',
  'Enrollable Blackout: persiana enrollable con tela de oscurecimiento para privacidad y control de luz; recomendada para habitaciones.',
  'Onda Serena Blackout: cortina de pliegue ondulado y tela blackout para oscurecimiento y privacidad.',
  'Onda Serena Velo: cortina de pliegue ondulado con tela traslúcida para luz natural filtrada y una caída fluida.'
]);

function validateGeneralNote(value) {
  const note = trim(value, 500);
  if (note.length < 8 || note.length > 500 ||
      /[\x00-\x08\x0b-\x1f]/.test(note) ||
      /\b\d{8,}\b/.test(note) ||
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(note) ||
      /(?:https?:\/\/|www\.)/i.test(note) ||
      /(?:contrase(?:n|ñ)a|password|api[_ -]?key|token de acceso|bearer|clave secreta|cuenta bancaria|tarjeta de credito)/i.test(note)) {
    throw fail('La nota debe describir un hecho comercial general sin teléfonos, correos, enlaces ni secretos.',
      'HOMMY_DESK_NOTE_INVALID');
  }
  return note;
}

function createHommyDesk(options = {}) {
  const dir = path.join(path.resolve(String(options.dataDir || '/app/data')), 'hommy-desk');
  const stateFile = path.join(dir,'notes.json');
  const catalogFile = path.join(dir,CATALOG_NAME);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  let state = {version:1,revision:0,notes:[],audit:[],settings:{customerCatalogAutoReply:false}};
  let unavailable = false;
  try {
    if (fs.existsSync(stateFile)) state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    if (!state || state.version!==1 || !Array.isArray(state.notes) ||
        !Array.isArray(state.audit) || !Number.isInteger(state.revision)) throw Error('Invalid desk state');
  } catch (_) {
    unavailable=true;
    state={version:1,revision:0,notes:[],audit:[],settings:{customerCatalogAutoReply:false}};
  }

  function requireAvailable() {
    if (unavailable) throw fail('La libreta de Hommy requiere recuperación. No sobrescribimos la información anterior.',
      'HOMMY_DESK_UNAVAILABLE',503);
  }
  function commit(op,actor) {
    requireAvailable();
    state.revision++;
    state.audit.push({at:new Date().toISOString(),action:op,
      actor:trim(actor && actor.profile && actor.profile.uid || 'system',80)});
    state.audit=state.audit.slice(-200);
    const temp=stateFile+'.'+process.pid+'.tmp';
    try {
      fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});
      fs.renameSync(temp,stateFile);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function catalogStatus() {
    try {
      const stat=fs.statSync(catalogFile);
      if (!stat.isFile() || stat.size < 1024 || stat.size > CATALOG_MAX_BYTES) return {installed:false};
      const f=fs.openSync(catalogFile,'r');
      try {
        const b=Buffer.alloc(5);
        fs.readSync(f,b,0,5,0);
        if(b.toString('ascii')!=='%PDF-')return {installed:false};
      } finally {fs.closeSync(f);}
      return {installed:true,filename:CATALOG_NAME,bytes:stat.size,
        sha256:crypto.createHash('sha256').update(fs.readFileSync(catalogFile)).digest('hex')};
    } catch(_) {return {installed:false};}
  }
  function readCatalog() {
    const info=catalogStatus();
    if(!info.installed)throw fail('El catálogo aún no está instalado en el escritorio de Hommy.',
      'HOMMY_CATALOG_NOT_INSTALLED',409);
    const bytes=fs.readFileSync(catalogFile);
    const sha=crypto.createHash('sha256').update(bytes).digest('hex');
    if(sha!==info.sha256)throw fail('El catálogo cambió durante la lectura.','HOMMY_CATALOG_CHANGED',409);
    return {filename:CATALOG_NAME,bytes,sha256:sha};
  }
  function installCatalog(bytes,actor) {
    requireAvailable();
    if(!Buffer.isBuffer(bytes)||bytes.length<1024||bytes.length>CATALOG_MAX_BYTES ||
       bytes.subarray(0,5).toString('ascii')!=='%PDF-' ||
       !/%%EOF\s*$/.test(bytes.subarray(Math.max(0,bytes.length-4096)).toString('latin1'))) {
      throw fail('Debes subir un archivo PDF válido de máximo 12 MB.',
        'HOMMY_CATALOG_INVALID',422);
    }
    const temp=catalogFile+'.'+process.pid+'.upload';
    try {
      fs.writeFileSync(temp,bytes,{mode:0o600});
      fs.renameSync(temp,catalogFile);
      commit('CATALOG_INSTALLED',actor);
      return catalogStatus();
    } finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function customerCatalogEnabled() {
    return !unavailable && state.settings &&
      state.settings.customerCatalogAutoReply === true &&
      catalogStatus().installed === true;
  }
  function setCustomerCatalogAutomation(enabled,actor) {
    requireAvailable();
    if (enabled === true && !catalogStatus().installed)
      throw fail('Instala el PDF oficial antes de activar respuestas automáticas.',
        'HOMMY_CATALOG_REQUIRED',409);
    if(!state.settings || typeof state.settings!=='object')state.settings={};
    state.settings.customerCatalogAutoReply=enabled===true;
    commit('CATALOG_AUTOMATION_CHANGED',actor);
    return {customerCatalogEnabled:customerCatalogEnabled()};
  }

  function notesFor(kind='TEAM') {
    return state.notes.filter(note=>note.active===true &&
      (kind==='TEAM'||note.visibility==='PUBLIC'))
      .slice(-30).map(note=>({topic:note.topic,text:note.text,source:'APPROVED_NOTE'}));
  }
  function addNote(body={},actor) {
    requireAvailable();
    if(state.notes.filter(x=>x.active).length>=MAX_NOTES)
      throw fail('El bloc está lleno. Archiva o actualiza una nota anterior.','HOMMY_DESK_FULL',409);
    const topic=trim(body.topic,70);
    if(topic.length<3 || /[\x00-\x1f]/.test(topic) ||
       /\b\d{8,}\b/.test(topic) || /[@<>]/.test(topic)) throw fail('El título de la nota no es válido.','HOMMY_NOTE_TOPIC_INVALID');
    const text=validateGeneralNote(body.text);
    const visibility=body.visibility==='PUBLIC'?'PUBLIC':'TEAM';
    if(state.notes.some(n=>n.active && normal(n.topic)===normal(topic))) {
      throw fail('Ya existe una nota con ese título. Puedes editarla.','HOMMY_NOTE_EXISTS',409);
    }
    const now=new Date().toISOString();
    const note={id:'note_'+crypto.randomUUID(),topic,text,visibility,active:true,
      source:'MANUAL_APPROVED',createdAt:now,updatedAt:now};
    state.notes.push(note);
    commit('NOTE_ADDED',actor);
    return note;
  }
  function editNote(body={},actor) {
    requireAvailable();
    const note=state.notes.find(x=>x.id===trim(body.id,90)&&x.active);
    if(!note)throw fail('Nota no encontrada.','HOMMY_NOTE_NOT_FOUND',404);
    const text=validateGeneralNote(body.text);
    note.text=text;
    if(body.visibility==='PUBLIC'||body.visibility==='TEAM')note.visibility=body.visibility;
    note.updatedAt=new Date().toISOString();
    commit('NOTE_EDITED',actor);
    return note;
  }
  function archiveNote(body={},actor) {
    requireAvailable();
    const note=state.notes.find(x=>x.id===trim(body.id,90)&&x.active);
    if(!note)throw fail('Nota no encontrada.','HOMMY_NOTE_NOT_FOUND',404);
    note.active=false;note.updatedAt=new Date().toISOString();
    commit('NOTE_ARCHIVED',actor);
    return {id:note.id,archived:true};
  }
  function dashboard(){
    return {available:!unavailable,revision:state.revision,
      catalog:catalogStatus(),
      automation:{customerCatalogEnabled:customerCatalogEnabled()},
      notes:state.notes.filter(x=>x.active).map(x=>({...x})).reverse(),
      catalogProducts:PRODUCT_FACTS.map(x=>x.split(':')[0])};
  }
  function approvedContext(kind='TEAM'){
    return {source:'HOMEEASY_APPROVED_DESK',notes:notesFor(kind),
      catalogProducts:PRODUCT_FACTS.slice(),
      catalogInstalled:catalogStatus().installed};
  }
  return Object.freeze({dashboard,installCatalog,readCatalog,catalogStatus,
    addNote,editNote,archiveNote,approvedContext,
    customerCatalogEnabled,setCustomerCatalogAutomation});
}

module.exports=Object.freeze({createHommyDesk,PRODUCT_FACTS,CATALOG_NAME,CATALOG_MAX_BYTES});
