'use strict';

const { SyncError } = require('./errors');

class HomeEasySyncClient {
  constructor(options = {}) {
    this.backendUrl = String(options.backendUrl || process.env.HOMEEASY_BACKEND_URL || 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs || 30000));
  }

  async request(tipo, payload, context) {
    const token = String(context && context.sessionToken || '');
    const deviceId = String(context && context.deviceId || '');
    const serviceKey = String(context && context.serviceKey || '');
    if ((!token && !serviceKey) || !deviceId) throw new SyncError('HomeEasy session or scheduler service key is required', { code: 'HOMEEASY_SYNC_SESSION_REQUIRED', statusCode: 401 });
    let response;
    try {
      response = await this.fetch(this.backendUrl, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ tipo, ...(payload || {}), appSessionToken: token, ...(serviceKey ? { pentagramaSyncKey: serviceKey } : {}), meta: {
          dispositivoId: deviceId, dispositivoNombre: String(context.deviceName || 'Pentagrama Sync').slice(0, 120),
          plataforma: String(context.platform || 'VPS').slice(0, 80), navegador: String(context.browser || 'HTTP').slice(0, 80),
          pagina: 'pentagrama-sync', versionApp: '2.0.0', origen: 'HomeEasy Pentagrama Sync'
        }}), redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (_) { throw new SyncError('HomeEasy sync backend is unavailable', { code: 'HOMEEASY_SYNC_UPSTREAM_UNAVAILABLE', statusCode: 502 }); }
    const text = await response.text().catch(() => '');
    let data; try { data = JSON.parse(text); } catch (_) {}
    if (!response.ok || !data || data.status !== 'ok') {
      throw new SyncError(String(data && (data.msg || data.error) || 'HomeEasy sync backend rejected the request'), {
        code: String(data && data.code || 'HOMEEASY_SYNC_INVALID_RESPONSE'), statusCode: response.status === 401 ? 401 : 502
      });
    }
    return data;
  }

  catalog(context) { return this.request('COSTOS_SYNC_READ', {}, context); }
  apply(scan, changes, context) { return this.request('COSTOS_SYNC_APPLY', { scanId: scan.id, scannedAt: scan.checkedAt, changes }, context); }
  rollback(historyId, context) { return this.request('COSTOS_SYNC_ROLLBACK', { historyId }, context); }
  history(context) { return this.request('COSTOS_SYNC_HISTORY', {}, context); }
}

module.exports = Object.freeze({ HomeEasySyncClient });
