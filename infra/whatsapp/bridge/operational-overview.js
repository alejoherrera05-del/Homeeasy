'use strict';
const fs = require('fs');
const path = require('path');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
function classify(text) {
  const q = normalize(text);
  if (/^(pendientes|que pendientes tenemos|que tenemos pendientes?|que hay pendientes?|tareas pendientes|resumen de pendientes)$/.test(q)) return 'PENDING';
  if (/^(resumen|resumen comercial|estado comercial|como vamos|reporte comercial)$/.test(q)) return 'SUMMARY';
  if (/^(cotizaciones|cotizaciones pendientes|cotizaciones por revisar|que cotizaciones tenemos|como van las cotizaciones)$/.test(q)) return 'QUOTES';
  if (/^(visitas|visitas pendientes|visitas por confirmar|que visitas tenemos|como van las visitas)$/.test(q)) return 'VISITS';
  if (/^(seguimiento|seguimientos|seguimientos pendientes|clientes en seguimiento)$/.test(q)) return 'FOLLOWUP';
  if (/^(clientes|clientes registrados|cuantos clientes tenemos)$/.test(q)) return 'CLIENTS';
  return null;
}
function summarize(state) {
  if (!state || state.version !== 2 || !state.clients || !state.opportunities ||
    Array.isArray(state.clients) || Array.isArray(state.opportunities)) throw Error('INVALID_MEMORY');
  const open = Object.values(state.opportunities).filter(o => o && o.status === 'OPEN');
  return Object.freeze({ available:true, clients:Object.keys(state.clients).length, open:open.length,
    quotes:open.filter(o => Array.isArray(o.quoteNumbers) && o.quoteNumbers.some(Boolean)).length,
    quoteDetails:open.filter(o => o.nextAction === 'REQUEST_QUOTE_DETAILS').length,
    visitDetails:open.filter(o => o.nextAction === 'COLLECT_VISIT_DETAILS').length });
}
function createOverview(root) {
  const file = path.join(path.resolve(root), 'hommy-intelligence', 'state-v2.json');
  let key = '', cache = null;
  return () => {
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > 8 * 1024 * 1024) return {available:false};
      const next = [st.ino,st.mtimeMs,st.size].join(':');
      if (cache && key === next) return cache;
      cache = summarize(JSON.parse(fs.readFileSync(file, 'utf8')));
      key = next;
      return cache;
    } catch (_) { cache = null; key = ''; return {available:false}; }
  };
}
function preview(type,tasks,labels,s) {
  const n = (tasks || []).filter(t => t && ['PENDIENTE','EN_CURSO'].includes(t.status)).length;
  const f = Object.values(labels || {}).filter(x => Array.isArray(x) && x.includes('SEGUIMIENTO')).length;
  const ok = s && s.available === true;
  if (type === 'PENDING') return (n ? 'Tengo ' + n + ' tareas manuales abiertas.' :
    'No tengo tareas manuales pendientes registradas.') +
    (ok ? ' En la memoria hay ' + s.open + ' oportunidades abiertas: ' + s.quoteDetails +
      ' necesitan datos para cotizar y ' + s.visitDetails +
      ' datos de visita. No todas requieren respuesta; solo cuento conversaciones analizadas.' :
      ' La memoria comercial no está disponible.');
  if (type === 'SUMMARY') return 'Hay ' + n + ' tareas manuales abiertas.' +
    (ok ? ' Hommy conoce ' + s.clients + ' clientes y ' + s.open + ' oportunidades en su memoria.' :
      ' No pude consultar la memoria comercial.') + ' Todavía no cubre todos los chats ni la agenda.';
  if (type === 'QUOTES') return ok ? 'Veo ' + s.quotes + ' oportunidades con referencia de cotización y ' +
    s.quoteDetails + ' que necesitan datos para cotizar. No puedo confirmar envíos ni valores desde aquí.' :
    'No pude consultar la memoria de cotizaciones.';
  if (type === 'VISITS') return ok ? 'Veo ' + s.visitDetails +
    ' oportunidades a las que falta información de visita. Todavía no tengo una agenda confirmada.' :
    'No pude consultar la memoria y todavía no tengo la agenda de visitas confirmadas.';
  if (type === 'FOLLOWUP') return 'Hay ' + f + ' clientes con etiqueta Seguimiento y ' + n +
    ' tareas manuales abiertas. No incluye todos los chats sin responder.';
  if (type === 'CLIENTS') return ok ? 'Hommy conoce ' + s.clients +
    ' clientes analizados; no son todos los contactos de WhatsApp.' : 'No pude consultar la memoria de clientes.';
  return null;
}
module.exports = Object.freeze({ classify, summarize, createOverview, preview });
