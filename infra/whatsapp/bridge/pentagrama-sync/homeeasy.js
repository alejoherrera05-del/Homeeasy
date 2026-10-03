'use strict';

const { SyncError } = require('./errors');

class HomeEasyCostClient {
  constructor(options = {}) {
    this.backendUrl = String(options.backendUrl || process.env.HOMEEASY_BACKEND_URL || 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec').trim();
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(3000, Number(options.timeoutMs || 20000));
  }

  async cost(item, context = {}) {
    const token = String(context.sessionToken || '').trim();
    const deviceId = String(context.deviceId || '').trim();
    if (!token || !deviceId) {
      throw new SyncError('HomeEasy session and device context are required for live cost comparison', {
        code: 'HOMEEASY_COST_SESSION_REQUIRED',
        statusCode: 401
      });
    }
    let response;
    try {
      response = await this.fetch(this.backendUrl, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          tipo: 'COSTOS_CALCULAR_COTIZACION',
          items: [item],
          transport: '0',
          installation: '0',
          margin: '0',
          installMode: 'common',
          promotions: true,
          appSessionToken: token,
          meta: {
            dispositivoId: deviceId,
            dispositivoNombre: String(context.deviceName || 'Pentagrama Sync').slice(0, 120),
            plataforma: String(context.platform || 'VPS').slice(0, 80),
            navegador: String(context.browser || 'HTTP').slice(0, 80),
            pagina: 'pentagrama-sync',
            versionApp: '1.0.0',
            origen: 'HomeEasy Pentagrama Sync'
          }
        }),
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (_) {
      throw new SyncError('HomeEasy cost service is unavailable', { code: 'HOMEEASY_COST_UPSTREAM_UNAVAILABLE', statusCode: 502 });
    }
    const text = await response.text().catch(() => '');
    let data;
    try { data = JSON.parse(text); } catch (_) {}
    if (!response.ok || !data || data.status !== 'ok' || !data.quote || data.quote.ok !== true) {
      const code = data && data.code ? String(data.code) : 'HOMEEASY_COST_INVALID_RESPONSE';
      const statusCode = ['APP_SESSION_EXPIRED', 'APP_SESSION_REJECTED', 'NO_SESSION'].includes(code) ? 401 : 502;
      throw new SyncError('HomeEasy could not calculate the mapped cost', { code, statusCode });
    }
    const calculated = Array.isArray(data.quote.items) ? data.quote.items[0] : null;
    const cents = Number(calculated && calculated.unit);
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new SyncError('HomeEasy cost response does not contain a valid unit amount', { code: 'HOMEEASY_COST_INVALID_AMOUNT', statusCode: 502 });
    }
    return { amount: cents / 100, version: String(data.version || ''), validThrough: String(data.validThrough || '') };
  }
}

module.exports = Object.freeze({ HomeEasyCostClient });
