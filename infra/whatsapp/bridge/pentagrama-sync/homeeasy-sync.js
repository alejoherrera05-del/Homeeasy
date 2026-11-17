'use strict';

const { SyncError } = require('./errors');

function applyHistoryType(payload = {}) {
  if (Array.isArray(payload.catalogMutations)) return 'CATALOG_APPLY';
  if (payload.modelCandidate) return 'LOCAL_MODEL_APPLY';
  return 'APPLY';
}

function parsedQa(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch (_) { return null; }
}

class HomeEasySyncClient {
  constructor(options = {}) {
    this.backendUrl = String(options.backendUrl || process.env.HOMEEASY_BACKEND_URL || 'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs ?? 45000));
    this.applyTimeoutMs = Math.max(this.timeoutMs, Number(options.applyTimeoutMs ?? 5 * 60 * 1000));
    this.applyReconcileAttempts = Math.max(0, Number(options.applyReconcileAttempts ?? 18));
    this.applyReconcileDelayMs = Math.max(0, Number(options.applyReconcileDelayMs ?? 5000));
    this.lockRetryDelayMs = Math.max(0, Number(options.lockRetryDelayMs ?? 3000));
    this.lockResponseThresholdMs = Math.max(0, Number(options.lockResponseThresholdMs ?? 25000));
  }

  async reconcileApply(payload, context, requestStartedAt) {
    const scanId = String(payload && payload.scanId || '');
    if (!scanId || !this.applyReconcileAttempts) return null;
    const expectedType = applyHistoryType(payload);
    const notBefore = Number(requestStartedAt || Date.now()) - 5000;

    for (let attempt = 0; attempt < this.applyReconcileAttempts; attempt += 1) {
      try {
        const history = await this.history(context);
        const items = Array.isArray(history && history.items) ? history.items : [];
        const match = items.find(item =>
          String(item && item.scanId || '') === scanId &&
          String(item && item.type || '') === expectedType &&
          String(item && item.state || '') === 'APLICADO' &&
          Date.parse(String(item && item.at || '')) >= notBefore &&
          !String(item && item.revertedBy || '')
        );
        if (match) {
          return {
            status: 'ok',
            historyId: String(match.id || ''),
            changed: Number(match.changes || 0),
            qa: parsedQa(match.qa),
            reconciled: true
          };
        }
      } catch (_) {
        // The history endpoint can be unavailable during the same transient
        // outage. Keep the reconciliation bounded and fail closed afterward.
      }
      if (attempt + 1 < this.applyReconcileAttempts && this.applyReconcileDelayMs) {
        await new Promise(resolve => setTimeout(resolve, this.applyReconcileDelayMs));
      }
    }
    return null;
  }

  async request(tipo, payload, context) {
    const token = String(context && context.sessionToken || '');
    const deviceId = String(context && context.deviceId || '');
    const serviceKey = String(context && context.serviceKey || '');
    if ((!token && !serviceKey) || !deviceId) throw new SyncError('HomeEasy session or scheduler service key is required', { code: 'HOMEEASY_SYNC_SESSION_REQUIRED', statusCode: 401 });
    const body = JSON.stringify({ tipo, ...(payload || {}), appSessionToken: token, ...(serviceKey ? { pentagramaSyncKey: serviceKey } : {}), meta: {
      dispositivoId: deviceId, dispositivoNombre: String(context.deviceName || 'Pentagrama Sync').slice(0, 120),
      plataforma: String(context.platform || 'VPS').slice(0, 80), navegador: String(context.browser || 'HTTP').slice(0, 80),
      pagina: 'pentagrama-sync', versionApp: '2.0.0', origen: 'HomeEasy Pentagrama Sync'
    }});

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      const startedAt = Date.now();
      try {
        response = await this.fetch(this.backendUrl, {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=utf-8' },
          body, redirect: 'follow', signal: AbortSignal.timeout(String(tipo) === 'COSTOS_SYNC_APPLY' ? this.applyTimeoutMs : this.timeoutMs)
        });
      } catch (_) {
        if (String(tipo) === 'COSTOS_SYNC_APPLY') {
          const reconciled = await this.reconcileApply(payload, context, startedAt);
          if (reconciled) return reconciled;
        }
        throw new SyncError('HomeEasy sync backend is unavailable', { code: 'HOMEEASY_SYNC_UPSTREAM_UNAVAILABLE', statusCode: 502 });
      }

      const elapsedMs = Date.now() - startedAt;
      const text = await response.text().catch(() => '');
      let data; try { data = JSON.parse(text); } catch (_) {}

      // Apps Script's transactional writer waits up to 30 s for ScriptLock.
      // When that wait expires outside the handler's JSON catch, Google returns
      // an HTML error page. A single retry is safe because the writer has not
      // entered the mutation block and therefore has not written any rows.
      const looksLikeLockTimeout =
        String(tipo) === 'COSTOS_SYNC_APPLY' &&
        response.ok &&
        !data &&
        elapsedMs >= this.lockResponseThresholdMs;

      if (looksLikeLockTimeout && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, this.lockRetryDelayMs));
        continue;
      }

      if (looksLikeLockTimeout) {
        throw new SyncError('HomeEasy está ocupado por otra operación. No se modificaron datos.', {
          code: 'HOMEEASY_SYNC_LOCK_BUSY',
          statusCode: 503
        });
      }

      if (!response.ok || !data || data.status !== 'ok') {
        throw new SyncError(String(data && (data.msg || data.error) || 'HomeEasy sync backend rejected the request'), {
          code: String(data && data.code || 'HOMEEASY_SYNC_INVALID_RESPONSE'), statusCode: response.status === 401 ? 401 : 502
        });
      }
      return data;
    }

    throw new SyncError('HomeEasy sync backend rejected the request', { code: 'HOMEEASY_SYNC_INVALID_RESPONSE', statusCode: 502 });
  }

  catalog(context) { return this.request('COSTOS_SYNC_READ', {}, context); }
  apply(scan, changes, context) { return this.request('COSTOS_SYNC_APPLY', { scanId: scan.id, scannedAt: scan.checkedAt, changes }, context); }
  applyCatalog(scan, catalogMutations, context) { return this.request('COSTOS_SYNC_APPLY', { scanId: scan.id, scannedAt: scan.checkedAt, catalogMutations }, context); }
  applyLocalModel(scan, modelCandidate, context) { return this.request('COSTOS_SYNC_APPLY', { scanId: scan.id, scannedAt: scan.checkedAt, modelCandidate }, context); }
  rollback(historyId, context) { return this.request('COSTOS_SYNC_ROLLBACK', { historyId }, context); }
  history(context) { return this.request('COSTOS_SYNC_HISTORY', {}, context); }
}

module.exports = Object.freeze({ HomeEasySyncClient });
