'use strict';
const fs = require('fs');
const path = require('path');
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
function classify(text) {
  // Natural, read-only team questions. Do not mistake a live-status request
  // for the narrower analyzed-memory summary that this fast path can provide.
  let q = normalize(text);
  q = q.replace(/^(?:(?:oye|mira|hola|hey|ey|bueno|porfa|por favor|una pregunta|jefe)\s+){1,3}/, '');
  q = q.replace(/^(?:me cuentas|cuentame|puedes contarme|me dices|dime|sabes)\s+(?:por favor\s+)?(como vamos con|como van|que tenemos de|que tenemos en|que hay de|que hay en)\s+/, '$1 ');
  const patterns = [
    ['PENDING', /^(?:pendientes|que pendientes tenemos|que tenemos pendiente[s]?|que hay pendiente[s]?|tareas pendientes|resumen de pendientes|como vamos con los pendientes|como vamos de pendientes|que nos falta por hacer)$/],
    ['SUMMARY', /^(?:resumen|resumen comercial|estado comercial|como vamos|como va todo|como va la cosa|como esta la cosa|que tal vamos|que tal vamos con el negocio|reporte comercial|como va homeeasy|como vamos con homeeasy)$/],
    ['QUOTES', /^(?:cotizaciones|cotizaciones pendientes|cotizaciones por revisar|que cotizaciones tenemos|como van las cotizaciones|como vamos con las cotizaciones|que tal van las cotizaciones|que tenemos de cotizaciones|que hay de cotizaciones)$/],
    ['VISITS', /^(?:visitas|visitas pendientes|visitas por confirmar|que visitas tenemos|como van las visitas|como vamos con las visitas|que tal van las visitas|que hay de las visitas|que tenemos de visitas)$/],
    ['FOLLOWUP', /^(?:seguimiento|seguimientos|seguimientos pendientes|clientes en seguimiento|como van los seguimientos|como vamos con los seguimientos|que tal los seguimientos)$/],
    ['CLIENTS', /^(?:clientes|clientes registrados|cuantos clientes tenemos|cuantos clientes conoces|que clientes tenemos registrados)$/]
  ];
  for (const [type, pattern] of patterns) if (pattern.test(q)) return type;
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
  if (type === 'SUMMARY') return 'Te cuento: en el tablero tengo ' + tasksText + '.' +
    (ok ? ' En las conversaciones que he analizado aparecen ' +
      phrase(s.clients, 'un cliente', 'clientes') + ' y ' +
      phrase(s.open, 'una oportunidad abierta', 'oportunidades abiertas') + '.' :
      ' Ahora mismo no pude consultar la memoria comercial.') +
    ' Es un resumen parcial; no incluye todos los chats ni la agenda.';
  if (type === 'QUOTES') {
    if (!ok) return 'Ahora mismo no pude consultar la memoria de cotizaciones.';
    const referenced = s.quotes
      ? 'Tengo ' + phrase(s.quotes, 'una oportunidad con referencia de cotización', 'oportunidades con referencia de cotización')
      : 'No veo referencias de cotización entre las conversaciones analizadas';
    const needing = s.quoteDetails
      ? 'También veo ' + phrase(s.quoteDetails, 'una que necesita', 'que necesitan') + ' datos para cotizar.'
      : 'No veo oportunidades marcadas como pendientes de datos para cotizar.';
    return referenced + '. ' + needing + ' No puedo confirmar envíos ni valores desde aquí.';
  }
  if (type === 'VISITS') {
    if (!ok) return 'Ahora mismo no pude consultar la memoria comercial y todavía no tengo una agenda confirmada.';
    const detail = s.visitDetails
      ? 'En lo que he revisado hay ' + phrase(s.visitDetails, 'una oportunidad que necesita', 'oportunidades que necesitan') + ' información para la visita.'
      : 'En las conversaciones analizadas no veo visitas marcadas como pendientes de datos.';
    return detail + ' Eso no significa que no haya citas: todavía no tengo una agenda confirmada.';
  }
  if (type === 'FOLLOWUP') return (f
    ? 'Tengo ' + phrase(f, 'un cliente con etiqueta Seguimiento', 'clientes con etiqueta Seguimiento') + '.'
    : 'Por ahora no tengo clientes marcados con la etiqueta Seguimiento.') +
    ' En tareas manuales hay ' + tasksText + '. No incluye todos los chats sin responder.';
  if (type === 'CLIENTS') return ok
    ? 'En las conversaciones analizadas tengo registrados ' + phrase(s.clients, 'un cliente', 'clientes') +
      '. No es el total de contactos de WhatsApp.'
    : 'Por ahora no pude consultar la memoria de clientes.';
  return null;
}

const KNOWN_PRODUCTS = Object.freeze([
  'Onda Serena', 'Sheer Elegance', 'Sheer Vertesse', 'Panel Japonés', 'Blackout'
]);

// Only narrow, explicitly informational searches. Mixed instructions are never
// promoted to INFORMATION, regardless of the product or client mentioned.
function parseClientQuery(value) {
  const q = normalize(value).replace(/^(?:oye|hola|hey|ey|porfa|por favor)[, ]+/, '');
  if (!q || q.length > 180) return null;
  // A mixed query is always a REVIEW action. A product word does not authorize sending.
  const actionWords = /\b(?:manda\w*|mandale\w*|dile\w*|diles\w*|dame\w*|pasame\w*|envia\w*|escribe\w*|avisale\w*|avisa\w*|responde\w*|etiqueta\w*|marca\w*|borra\w*|elimina\w*|contacta\w*|confirma\w*|llama\w*|agenda\w*|reserva\w*|programa\w*|crea\w*|cotiza\w*)\b/;
  if (actionWords.test(q)) return null;
  const productAliases = [
    { canonical: 'Onda Serena', match: /\bonda serena\b/ },
    { canonical: 'Sheer Elegance', match: /\bsheer elegance\b/ },
    { canonical: 'Sheer Vertesse', match: /\bsheer vertesse\b/ },
    { canonical: 'Panel Japonés', match: /\bpanel japones\b/ },
    { canonical: 'Blackout', match: /\bblack\s?out\b/ }
  ];
  const products = productAliases.filter(p => p.match.test(q));
  if (products.length > 1) return null;
  const intent = /^(?:que sabemos|que conoces|que ha pasado|que paso|como va|como vamos|como sigue|en que va|en que quedo|en que estamos|hay novedades|tienes novedades|dime|cuentame|me cuentas|que hay|como esta|estado de|cliente\b|la cortina|la persiana|el panel|sobre\b|de\b)/.test(q);
  if (products.length === 1) {
    const product = products[0].canonical;
    const bare = q.replace(/^(?:sobre\s+)?(?:el|la|los|las)\s+/, '');
    if (intent || bare === normalize(product)) {
      return { kind: 'PRODUCT', target: normalize(product), product };
    }
    return null;
  }
  const named = /^(?:cliente(?:\s+de)?\s+|que sabemos de\s+|que conoces de\s+|que paso con\s+|como va lo de\s+|estado de\s+|cuentame de\s+|dime de\s+)(.+)$/.exec(q);
  if (!named) return null;
  const name = named[1].replace(/^(?:el cliente|la cliente|la persona)\s+(?:de\s+)?/, '').trim();
  if (name.length < 3 || name.length > 65 || /\b(?:precio|cotizacion|visita|persiana|cortina|pedido|cliente|agenda|telefono)\b/.test(name)) return null;
  return { kind: 'NAME', target: name, product: null };
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
    if (!matches.length) return 'Por ahora no tengo registrada una oportunidad de ' + request.product +
      ' entre las conversaciones que he analizado. Eso no significa que no exista en WhatsApp.';
  } else {
    const candidateClients = clients.filter(c => normalize(c.name) === request.target);
    if (candidateClients.length > 1) return 'Encuentro más de un cliente con ese nombre en la memoria. ' +
      'Necesito otra referencia para saber de cuál hablamos.';
    if (!candidateClients.length) return 'Con ese nombre todavía no encuentro un cliente en mi memoria. ' +
      'Puede que la conversación esté en WhatsApp, pero no la haya analizado aún.';
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
    REQUEST_QUOTE_DETAILS: 'Por ahora faltan datos para poder cotizar.',
    COLLECT_VISIT_DETAILS: 'Falta completar información de la visita; todavía no hay una cita confirmada.',
    HUMAN_REVIEW: 'Hay algo que el equipo debe revisar.',
    WAIT: 'El último seguimiento quedó en espera.',
    PREPARE_RESPONSE: 'Hay una respuesta preparada, pendiente de revisión.',
    STOP_CONTACT: 'Está marcado para no volver a contactar.',
  }[opportunity.nextAction] || 'Aún no tengo claro cuál sería el siguiente paso.';
  const name = client && typeof client.name === 'string' ? client.name.trim() : '';
  const verifiedName = request.kind === 'NAME' ? null :
    client && client.provisional === false && !((client.identityConflicts || []).length) &&
      /^[A-Za-zÀ-ÿ'’.\s-]{2,65}$/u.test(name) ? name : null;
  const productText = product === 'Onda Serena' ? 'la cortina Onda Serena' :
    ['Sheer Elegance','Sheer Vertesse'].includes(product) ? 'la persiana ' + product :
    product === 'Panel Japonés' ? 'el panel japonés' : product === 'Blackout' ?
    'la opción blackout' : product;
  let response = 'Sobre ' + productText + ', tengo ' +
    (opportunity.status === 'OPEN' ? 'una oportunidad abierta' : 'una oportunidad registrada') +
    (verifiedName ? ' de ' + verifiedName : '') + '.';
  if (environment) response += ' Es para ' + (environment === 'sala' ? 'la sala' : environment === 'comedor' ? 'el comedor' : environment === 'estudio' ? 'el estudio' : environment === 'balcón' ? 'el balcón' : 'el espacio de ' + environment) + '.';
  response += ' ' + next;
  if (Array.isArray(opportunity.quoteNumbers) && opportunity.quoteNumbers.length)
    response += ' Hay una referencia de cotización, aunque no sé si ya se envió.';
  return response.slice(0, 580);
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
