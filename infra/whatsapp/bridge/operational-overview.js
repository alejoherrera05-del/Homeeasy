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

const KNOWN_PRODUCTS = Object.freeze([
  'Onda Serena', 'Sheer Elegance', 'Sheer Vertesse', 'Panel Japonés', 'Blackout'
]);

// Only narrow, explicitly informational searches. Mixed instructions are never
// promoted to INFORMATION, regardless of the product or client mentioned.
function parseClientQuery(value) {
  const q = normalize(value);
  const match = /^(?:cliente (?:de |que busca |interesado en )?|que sabemos de (?:el cliente de |la cortina |la persiana )?|que paso con (?:el cliente de )?|como va lo de |estado de )(.*?)$/.exec(q);
  if (!match) return null;
  let target = match[1].replace(/^(?:la |el |las |los )?(?:cortina|persiana)(?:s)? (?:de )?/, '').trim();
  if (target.length < 3 || target.length > 80 ||
      /\s+y\s+/.test(' ' + target + ' ') ||
      /\b(?:manda\w*|envia\w*|escribe\w*|avisa\w*|responde\w*|etiqueta\w*|borra\w*|elimina\w*|contacta\w*|confirma\w*|llama\w*|agenda\w*|descuento|precio)\b/.test(target)) return null;
  const product = KNOWN_PRODUCTS.find(p => normalize(p) === target);
  return { kind: product ? 'PRODUCT' : 'NAME', target, product: product || null };
}

function clientReport(state, request) {
  if (!state || state.version !== 2 || !state.clients || !state.opportunities ||
      Array.isArray(state.clients) || Array.isArray(state.opportunities)) {
    return 'No pude consultar la memoria comercial. No voy a adivinar datos de clientes.';
  }
  const clients = Object.values(state.clients).filter(c => c && c.id);
  const opportunities = Object.values(state.opportunities).filter(o => o && o.clientId);
  let matches;
  if (request.kind === 'PRODUCT') {
    matches = opportunities.filter(o => normalize(o.product) === normalize(request.product));
    if (matches.length > 1) return 'Encontré ' + matches.length +
      ' oportunidades relacionadas con ' + request.product +
      '. Necesito un cliente o espacio específico para distinguirlas; no voy a mezclar las conversaciones.';
    if (!matches.length) return 'No encuentro una oportunidad de ' + request.product +
      ' en la memoria que Hommy ya analizó. No he revisado todos los chats de WhatsApp.';
  } else {
    const candidateClients = clients.filter(c => normalize(c.name) === request.target);
    if (candidateClients.length > 1) return 'Encuentro más de un cliente con ese nombre en la memoria. ' +
      'Necesito otra referencia para saber de cuál hablamos.';
    if (!candidateClients.length) return 'No encuentro ese nombre exacto en los clientes analizados. ' +
      'Si me dices qué cortina o persiana busca, puedo consultar por producto.';
    const id = candidateClients[0].id;
    matches = opportunities.filter(o => o.clientId === id);
    if (matches.length > 1) return 'Encontré ' + matches.length +
      ' oportunidades para ese cliente. Dime qué producto buscas y así evitamos mezclar pedidos.';
    if (!matches.length) return 'Encuentro al cliente en la memoria, pero todavía no hay una oportunidad comercial analizada para mostrar.';
  }
  const opportunity = matches[0];
  const client = clients.find(c => c.id === opportunity.clientId);
  const product = String(opportunity.product || 'un producto aún sin definir').slice(0, 75);
  const safeRooms = new Map([
    ['sala','sala'], ['comedor','comedor'], ['sala comedor','sala-comedor'],
    ['habitacion','habitación'], ['habitacion principal','habitación principal'],
    ['alcoba','alcoba'], ['alcoba principal','alcoba principal'], ['estudio','estudio'],
    ['oficina','oficina'], ['cocina','cocina'], ['bano','baño'],
    ['balcon','balcón'], ['terraza','terraza'], ['patio','patio']
  ]);
  const environment = Array.isArray(opportunity.environments) ?
    opportunity.environments.map(x => safeRooms.get(normalize(x))).find(Boolean) : null;
  const next = {
    REQUEST_QUOTE_DETAILS: 'Faltan datos para preparar una cotización.',
    COLLECT_VISIT_DETAILS: 'Falta completar información de la visita; no está confirmada.',
    HUMAN_REVIEW: 'Requiere revisión del equipo.',
    WAIT: 'El último análisis indicó esperar.',
    PREPARE_RESPONSE: 'Hay una respuesta propuesta para revisar.',
    STOP_CONTACT: 'No debemos contactar a esa persona.'
  }[opportunity.nextAction] || 'No hay un próximo paso verificado.';
  const name = client && typeof client.name === 'string' ? client.name.trim() : '';
  const verifiedName = request.kind === 'NAME' ? null :
    client && client.provisional === false && !((client.identityConflicts || []).length) &&
      /^[A-Za-zÀ-ÿ'’.\s-]{2,65}$/u.test(name) ? name : null;
  let response = 'Según la última conversación analizada, ' +
    (verifiedName ? verifiedName + ' tiene ' : 'hay ') +
    (opportunity.status === 'OPEN' ? 'una oportunidad abierta' : 'una oportunidad registrada') +
    ' relacionada con ' + product + '.';
  if (environment) response += ' Espacio: ' + environment.slice(0, 75) + '.';
  response += ' ' + next;
  if (Array.isArray(opportunity.quoteNumbers) && opportunity.quoteNumbers.length)
    response += ' Tiene referencia de cotización, pero no puedo confirmar que se haya enviado.';
  return response.slice(0, 750);
}

function createClientLookup(root) {
  const file = path.join(path.resolve(String(root)), 'hommy-intelligence', 'state-v2.json');
  let key = '', cache = null;
  return function lookup(text) {
    const request = parseClientQuery(text);
    if (!request) return null;
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > 8 * 1024 * 1024)
        return 'No pude consultar la memoria comercial. No voy a adivinar datos de clientes.';
      const next = [st.ino, st.mtimeMs, st.size].join(':');
      if (!cache || key !== next) {
        cache = JSON.parse(fs.readFileSync(file, 'utf8'));
        key = next;
      }
      return clientReport(cache, request);
    } catch (_) {
      cache = null;
      key = '';
      return 'No pude consultar la memoria comercial. No voy a adivinar datos de clientes.';
    }
  };
}

module.exports = Object.freeze({ classify, summarize, createOverview, preview, parseClientQuery, clientReport, createClientLookup });
