'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = String(process.env.DATA_DIR || '/app/data');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const MAX_ACTIVITY = 600;
const MAX_TEMPLATE_LENGTH = 1000;

const DEFAULT_TEMPLATES = Object.freeze({
  cotizacion: [
    'Hola, *{nombre}* 👋',
    '',
    'Te compartimos tu *Cotización {numero}* de HomeEasy.',
    '',
    'En el PDF encontrarás el detalle de tu propuesta, productos, medidas y valores.',
    '',
    'Si deseas realizar algún ajuste o tienes alguna duda, puedes responder directamente a este mensaje. Con gusto te ayudamos.',
    '',
    '*HomeEasy*',
    '_Viste tu hogar con estilo_ ✨'
  ].join('\n'),
  pedido: [
    'Hola, *{nombre}* 👋',
    '',
    'Te compartimos tu *Orden de Pedido {numero}* de HomeEasy.',
    '',
    'Te recomendamos revisar los productos, medidas, acabados y valores registrados en el documento adjunto.',
    '',
    'Si encuentras alguna novedad, escríbenos por este mismo medio.',
    '',
    '*HomeEasy*',
    '_Viste tu hogar con estilo_ ✨'
  ].join('\n'),
  abono: [
    'Hola, *{nombre}* 👋',
    '',
    'Hemos registrado correctamente tu abono de *{valor}* correspondiente a la *{op}*.',
    '',
    'Te adjuntamos tu *Recibo de Abono {numero}* en PDF para tu respaldo.',
    '',
    '{estado_saldo}',
    '',
    'Gracias por confiar en *HomeEasy*. 🤍'
  ].join('\n'),
  reenvio: [
    'Hola, *{nombre}* 👋',
    '',
    'Tal como solicitaste, te reenviamos {documento} de HomeEasy.',
    '',
    'Encontrarás el documento adjunto en PDF.',
    '',
    '*HomeEasy*',
    '_Viste tu hogar con estilo_ ✨'
  ].join('\n')
});

const TEMPLATE_KEYS = Object.freeze(Object.keys(DEFAULT_TEMPLATES));
const TEMPLATE_VARIABLES = Object.freeze({
  cotizacion: ['{nombre}', '{numero}'],
  pedido: ['{nombre}', '{numero}'],
  abono: ['{nombre}', '{numero}', '{op}', '{valor}', '{estado_saldo}'],
  reenvio: ['{nombre}', '{documento}']
});

fs.mkdirSync(DATA_DIR, { recursive: true });

function clean(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, maxLength || 500);
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function normalizeTemplates(source, fallback) {
  const base = fallback || DEFAULT_TEMPLATES;
  const input = source && typeof source === 'object' ? source : {};
  const out = {};
  TEMPLATE_KEYS.forEach(key => {
    const value = Object.prototype.hasOwnProperty.call(input, key) ? String(input[key] == null ? '' : input[key]) : String(base[key] || '');
    const normalized = value.replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEMPLATE_LENGTH);
    out[key] = normalized || String(base[key] || '');
  });
  return out;
}

let templateState = (() => {
  const stored = readJson(TEMPLATES_FILE, null);
  return {
    templates: normalizeTemplates(stored && stored.templates, DEFAULT_TEMPLATES),
    updatedAt: clean(stored && stored.updatedAt, 80) || null,
    updatedBy: clean(stored && stored.updatedBy, 160) || null
  };
})();

let activity = (() => {
  const stored = readJson(ACTIVITY_FILE, []);
  return Array.isArray(stored) ? stored.slice(-MAX_ACTIVITY) : [];
})();

function actorLabel(actor) {
  if (!actor || typeof actor !== 'object') return 'Sistema';
  return clean(actor.nombre || actor.email || actor.rol || 'Sistema', 160) || 'Sistema';
}

function templatePayload() {
  return {
    templates: { ...templateState.templates },
    defaults: { ...DEFAULT_TEMPLATES },
    variables: Object.fromEntries(Object.entries(TEMPLATE_VARIABLES).map(([key, value]) => [key, [...value]])),
    updatedAt: templateState.updatedAt,
    updatedBy: templateState.updatedBy
  };
}

function saveTemplates(templates, actor) {
  templateState = {
    templates: normalizeTemplates(templates, templateState.templates),
    updatedAt: new Date().toISOString(),
    updatedBy: actorLabel(actor)
  };
  writeJsonAtomic(TEMPLATES_FILE, templateState);
  return templatePayload();
}

function resetTemplates(actor) {
  templateState = {
    templates: { ...DEFAULT_TEMPLATES },
    updatedAt: new Date().toISOString(),
    updatedBy: actorLabel(actor)
  };
  writeJsonAtomic(TEMPLATES_FILE, templateState);
  return templatePayload();
}

function recordActivity(input) {
  const source = input && typeof input === 'object' ? input : {};
  const item = {
    id: clean(source.id, 120) || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
    at: clean(source.at, 80) || new Date().toISOString(),
    kind: clean(source.kind, 40) || 'document',
    state: clean(source.state, 40).toUpperCase() || 'UNKNOWN',
    documentType: clean(source.documentType, 40).toLowerCase(),
    reference: clean(source.reference, 120),
    clientName: clean(source.clientName, 160),
    phone: clean(source.phone, 32),
    filename: clean(source.filename, 220),
    source: clean(source.source, 60),
    resend: Boolean(source.resend),
    actor: clean(source.actor, 160),
    messageId: clean(source.messageId, 240),
    error: clean(source.error, 320)
  };
  activity.push(item);
  if (activity.length > MAX_ACTIVITY) activity = activity.slice(-MAX_ACTIVITY);
  writeJsonAtomic(ACTIVITY_FILE, activity);
  return item;
}

function getActivity(limit) {
  const size = Math.max(1, Math.min(150, Number(limit || 40)));
  return activity.slice(-size).reverse().map(item => ({ ...item }));
}

const TEST_PDF_BASE64 = 'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDU5NS4yNzU2IDg0MS44ODk4IF0gL1BhcmVudCA3IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNyAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODMxMTY1NDU1KzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODMxMTY1NDU1KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAyNTYKPj4Kc3RyZWFtCkdhcm87Ym1NPEEmLWhTZWBIUDsvQzE9U3E8KWJ1OSNSM0RoRVEqYC44czlVcl1lVEwuQTBIXzoxVykhP19tJnA5IWdqPmUoKD8taCo1S3VKS2loYjkpTmYqRjs8NmJqSWxNZCkxNipwTzZQTzJkRCpgNy1ZMzk9bmVXYF9uJCtsdSlER2xjUExfRTJSRCUvPzxYYjIsU0Y7VixhTkpgdEdhYW9zMENoQVM4a1I5M19EPTwxbDxIVVVJPkRHUl9QZFglSmZkX0M/byQvXVtEMT1NPlVHNypFaSg0ZmdVOjYoPyxacmZWY0JacmAvNV8yPC0jQ2JDMGNFIT4zYUhEfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDkgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNTI0IDAwMDAwIG4gCjAwMDAwMDA1OTIgMDAwMDAgbiAKMDAwMDAwMDg1MyAwMDAwMCBuIAowMDAwMDAwOTEyIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPGU3MzFlZjEyMzM5Mzg3ZTI3YjM0YjFmY2RkNjEzZjYyPjxlNzMxZWYxMjMzOTM4N2UyN2IzNGIxZmNkZDYxM2Y2Mj5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNiAwIFIKL1Jvb3QgNSAwIFIKL1NpemUgOQo+PgpzdGFydHhyZWYKMTI1OAolJUVPRgo=';

function testPdfBase64() {
  return TEST_PDF_BASE64;
}

function storageStatus() {
  try {
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    return 'OK';
  } catch (_) {
    return 'ERROR';
  }
}

module.exports = Object.freeze({
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  templatePayload,
  saveTemplates,
  resetTemplates,
  recordActivity,
  getActivity,
  testPdfBase64,
  storageStatus
});
