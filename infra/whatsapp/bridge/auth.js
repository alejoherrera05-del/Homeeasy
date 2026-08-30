'use strict';

const crypto = require('crypto');

const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || '');
const BACKEND_URL = String(process.env.HOMEEASY_BACKEND_URL || 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec').trim();
const ALLOWED_ORIGINS = new Set(
  String(process.env.HOMEEASY_ALLOWED_ORIGINS || 'https://alejoherrera05-del.github.io,https://homeeasy.com.co,https://www.homeeasy.com.co')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const CACHE_TTL_MS = Math.max(5000, Number(process.env.HOMEEASY_SESSION_CACHE_MS || 30000));
const cache = new Map();

function timingSafeTextEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function requestOrigin(req) {
  return String(req && req.headers && req.headers.origin || '').trim();
}

function applyCors(req, res) {
  const origin = requestOrigin(req);
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-HomeEasy-Session, X-HomeEasy-Token, X-HomeEasy-Device-Id, X-HomeEasy-Device-Name, X-HomeEasy-Platform, X-HomeEasy-Browser'
  );
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function isInternal(req) {
  return Boolean(BRIDGE_TOKEN) && timingSafeTextEqual(req && req.headers && req.headers['x-homeeasy-token'], BRIDGE_TOKEN);
}

function permissionsArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 160);
}

function profileObject(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    uid: String(source.uid || '').trim(),
    nombre: String(source.nombre || '').trim().slice(0, 160),
    email: String(source.email || '').trim().toLowerCase().slice(0, 180),
    rol: String(source.rol || '').trim().toUpperCase().slice(0, 80),
    estado: String(source.estado || '').trim().toUpperCase().slice(0, 80)
  };
}

function decodeHeaderValue(value, maxLength) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch (_) {}
  return decoded.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength || 180);
}

function requestDeviceMeta(req) {
  const headers = req && req.headers ? req.headers : {};
  return Object.freeze({
    dispositivoId: decodeHeaderValue(headers['x-homeeasy-device-id'], 180),
    dispositivoNombre: decodeHeaderValue(headers['x-homeeasy-device-name'], 120),
    plataforma: decodeHeaderValue(headers['x-homeeasy-platform'], 80),
    navegador: decodeHeaderValue(headers['x-homeeasy-browser'], 80)
  });
}

function cacheKey(token, deviceId) {
  return crypto.createHash('sha256')
    .update(String(token || ''))
    .update('\n')
    .update(String(deviceId || ''))
    .digest('hex');
}

function cachedActor(token, deviceId) {
  const key = cacheKey(token, deviceId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.actor;
}

function storeActor(token, deviceId, actor) {
  if (cache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (!entry || entry.expiresAt <= now) cache.delete(key);
      if (cache.size <= 400) break;
    }
  }
  cache.set(cacheKey(token, deviceId), { actor, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function validateOperationalSession(token, deviceMeta) {
  const rawToken = String(token || '').trim();
  if (!rawToken) throw authError('HomeEasy session required', 401);

  const meta = deviceMeta && typeof deviceMeta === 'object' ? deviceMeta : {};
  const deviceId = String(meta.dispositivoId || '').trim();
  if (!deviceId) {
    throw authError('HomeEasy device context required', 401, { code: 'DEVICE_CONTEXT_REQUIRED' });
  }

  const cached = cachedActor(rawToken, deviceId);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        tipo: 'AUTH_VALIDAR_SESION',
        appSessionToken: rawToken,
        meta: {
          dispositivoId: deviceId,
          dispositivoNombre: String(meta.dispositivoNombre || 'HomeEasy Web').trim().slice(0, 120),
          plataforma: String(meta.plataforma || '').trim().slice(0, 80),
          navegador: String(meta.navegador || '').trim().slice(0, 80),
          pagina: 'whatsapp-bridge',
          versionApp: '3.5',
          origen: 'HomeEasy WhatsApp Bridge'
        }
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw authError('HomeEasy authentication service unavailable', 502);
  }

  const text = await response.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}

  if (!response.ok) {
    throw authError('HomeEasy authentication service rejected the request', 502);
  }
  if (!data || data.status !== 'success' || data.valido !== true) {
    throw authError('HomeEasy session is not valid', 401, data && data.code ? { code: data.code } : undefined);
  }

  const profile = profileObject(data.perfil);
  if (!profile.uid || profile.estado === 'DESACTIVADO') {
    throw authError('HomeEasy user is not active', 403);
  }

  const actor = Object.freeze({
    internal: false,
    profile: Object.freeze(profile),
    permissions: Object.freeze(permissionsArray(data.permisos))
  });
  storeActor(rawToken, deviceId, actor);
  return actor;
}

function assertPermission(actor, required) {
  if (!required || actor && actor.internal) return true;
  const permissions = actor && Array.isArray(actor.permissions) ? actor.permissions : [];
  if (permissions.includes('*') || permissions.includes(required)) return true;
  throw authError('HomeEasy permission denied', 403, { permission: required });
}

async function authorize(req, requiredPermission) {
  if (isInternal(req)) {
    return Object.freeze({ internal: true, profile: Object.freeze({ rol: 'SYSTEM' }), permissions: Object.freeze(['*']) });
  }
  const token = String(req && req.headers && req.headers['x-homeeasy-session'] || '').trim();
  const actor = await validateOperationalSession(token, requestDeviceMeta(req));
  assertPermission(actor, requiredPermission);
  return actor;
}

function publicActor(actor) {
  if (!actor) return null;
  if (actor.internal) return { internal: true, rol: 'SYSTEM' };
  const profile = actor.profile || {};
  return {
    internal: false,
    uid: profile.uid || '',
    nombre: profile.nombre || '',
    email: profile.email || '',
    rol: profile.rol || ''
  };
}

module.exports = Object.freeze({
  applyCors,
  isInternal,
  authorize,
  assertPermission,
  publicActor
});
