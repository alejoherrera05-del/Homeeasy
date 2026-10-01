'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = process.env.MAINTENANCE_DIR || '/app/maintenance';
const requests = path.join(ROOT, 'requests');
let active = 0;
function error(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }
function status() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'status.json'), 'utf8')); }
  catch (_) { return { available: false, message: 'Mantenimiento todavía no disponible.' }; }
}
function authorize(actor) {
  if (!actor || (!actor.internal && !['ADMINISTRADOR', 'PROPIETARIO'].includes(actor.profile?.rol))) {
    throw error('Solo un administrador puede gestionar el mantenimiento.', 403);
  }
}
function writeAtomic(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function enqueue(actor, body) {
  authorize(actor);
  if (!['check', 'update', 'automatic'].includes(body?.action)) throw error('Acción no permitida.', 400);
  if (body.action === 'automatic' && typeof body.enabled !== 'boolean') throw error('Modo inválido.', 400);
  const current = status();
  if (!current.available || Date.now() - Date.parse(current.heartbeat) > 120000) throw error('El mantenimiento no responde.', 503);
  if (current.busy) throw error('Ya hay un mantenimiento en curso.', 409);
  const command = { id: crypto.randomUUID(), action: body.action, enabled: body.enabled,
    actor: actor.internal ? 'SYSTEM' : String(actor.profile.uid || '').slice(0, 160), at: new Date().toISOString() };
  try {
    // One fixed command slot; neither paths nor shell commands come from the browser.
    const fd = fs.openSync(path.join(requests, 'command.json'), 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(command)); } finally { fs.closeSync(fd); }
  } catch (e) { if (e.code === 'EEXIST') throw error('Hay una solicitud pendiente.', 409); throw e; }
  return { ok: true, queued: true, jobId: command.id };
}
function track() {
  if (!fs.existsSync(requests)) return () => {};
  const state = status();
  if (state.blockSends) throw error('WhatsApp está en mantenimiento. Tu documento está guardado; envíalo al finalizar.', 503);
  active += 1;
  const save = () => writeAtomic(path.join(requests, 'inflight.json'), { active, at: Date.now() });
  try { save(); } catch (e) { active -= 1; throw e; }
  let ended = false;
  return () => { if (!ended) { ended = true; active -= 1; save(); } };
}
// On process start, no old request can still be active in this process.
if (fs.existsSync(requests)) writeAtomic(path.join(requests, 'inflight.json'), { active: 0, at: Date.now() });
module.exports = { status, authorize, enqueue, track };
