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
function phrase(n, one, many) { return n === 1 ? one : n + ' ' + many; }
function preview(type,tasks,labels,s) {
  const n = (tasks || []).filter(t => t && ['PENDIENTE','EN_CURSO'].includes(t.status)).length;
  const f = Object.values(labels || {}).filter(x => Array.isArray(x) && x.includes('SEGUIMIENTO')).length;
  const ok = s && s.available === true;
  const tasksText = phrase(n, 'una tarea manual abierta', 'tareas manuales abiertas');
  if (type === 'PENDING') {
    let text = n ? 'Tengo ' + tasksText + '.' : 'No tengo tareas manuales pendientes registradas.';
    if (!ok) return text + ' No pude consultar la memoria comercial.';
    text += ' En la memoria comercial veo ' + phrase(s.open, 'una oportunidad abierta', 'oportunidades abiertas') + '.';
    if (s.quoteDetails) text += ' ' + phrase(s.quoteDetails, 'Una necesita', 'necesitan') + ' datos para cotizar.';
    if (s.visitDetails) text += ' ' + phrase(s.visitDetails, 'Una necesita', 'necesitan') + ' información de visita.';
    return text + ' No todas requieren respuesta; solo cuento conversaciones analizadas.';
  }
  if (type === 'SUMMARY') return 'En HomeEasy hay ' + tasksText + '.' +
    (ok ? ' Hommy conoce ' + phrase(s.clients, 'un cliente analizado', 'clientes analizados') +
      ' y ' + phrase(s.open, 'una oportunidad abierta', 'oportunidades abiertas') + '.' :
      ' No pude consultar la memoria comercial.') +
    ' Todavía no cubre todos los chats ni la agenda.';
  if (type === 'QUOTES') return ok
    ? 'Veo ' + phrase(s.quotes, 'una oportunidad con referencia de cotización', 'oportunidades con referencia de cotización') +
      ' y ' + phrase(s.quoteDetails, 'una que necesita', 'que necesitan') +
      ' datos para cotizar. No puedo confirmar envíos ni valores desde aquí.'
    : 'No pude consultar la memoria de cotizaciones.';
  if (type === 'VISITS') return ok
    ? 'Veo ' + phrase(s.visitDetails, 'una oportunidad que necesita', 'oportunidades que necesitan') +
      ' información de visita. Todavía no tengo una agenda confirmada.'
    : 'No pude consultar la memoria y todavía no tengo la agenda de visitas confirmadas.';
  if (type === 'FOLLOWUP') return 'Hay ' + phrase(f, 'un cliente con etiqueta Seguimiento', 'clientes con etiqueta Seguimiento') +
    ' y ' + tasksText + '. No incluye todos los chats sin responder.';
  if (type === 'CLIENTS') return ok
    ? 'Hommy conoce ' + phrase(s.clients, 'un cliente analizado', 'clientes analizados') +
      '; no son todos los contactos de WhatsApp.'
    : 'No pude consultar la memoria de clientes.';
  return null;
}
module.exports = Object.freeze({ classify, summarize, createOverview, preview });
