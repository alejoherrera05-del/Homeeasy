'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HomeEasySyncClient } = require('./homeeasy-sync');

function response(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    text: async () => body
  };
}

test('apply retries once when Apps Script returns non-JSON after lock wait', async () => {
  let calls = 0;
  const client = new HomeEasySyncClient({
    lockRetryDelayMs: 0,
    lockResponseThresholdMs: 0,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return response('<html>Exception: Could not acquire lock</html>');
      return response(JSON.stringify({ status: 'ok', changed: 29 }));
    }
  });

  const result = await client.applyCatalog(
    { id: 'scan-1', checkedAt: new Date().toISOString() },
    [{ kind: 'UPDATE_RATE', certified: true }],
    { serviceKey: 'key', deviceId: 'device' }
  );

  assert.equal(calls, 2);
  assert.equal(result.status, 'ok');
  assert.equal(result.changed, 29);
});

test('second lock-like non-JSON response becomes a precise busy error', async () => {
  let calls = 0;
  const client = new HomeEasySyncClient({
    lockRetryDelayMs: 0,
    lockResponseThresholdMs: 0,
    fetch: async () => {
      calls += 1;
      return response('<html>Exception: Could not acquire lock</html>');
    }
  });

  await assert.rejects(
    () => client.applyCatalog(
      { id: 'scan-2', checkedAt: new Date().toISOString() },
      [{ kind: 'UPDATE_RATE', certified: true }],
      { serviceKey: 'key', deviceId: 'device' }
    ),
    error => error && error.code === 'HOMEEASY_SYNC_LOCK_BUSY'
  );
  assert.equal(calls, 2);
});

test('structured HomeEasy backend errors are preserved and not retried', async () => {
  let calls = 0;
  const client = new HomeEasySyncClient({
    lockRetryDelayMs: 0,
    lockResponseThresholdMs: 0,
    fetch: async () => {
      calls += 1;
      return response(JSON.stringify({ status: 'error', code: 'PENTAGRAMA_SCAN_EXPIRED', msg: 'expired' }));
    }
  });

  await assert.rejects(
    () => client.applyCatalog(
      { id: 'scan-3', checkedAt: new Date().toISOString() },
      [{ kind: 'UPDATE_RATE', certified: true }],
      { serviceKey: 'key', deviceId: 'device' }
    ),
    error => error && error.code === 'PENTAGRAMA_SCAN_EXPIRED'
  );
  assert.equal(calls, 1);
});

test('large apply requests use a five-minute response window by default', () => {
  const client = new HomeEasySyncClient({ fetch: async () => response('{}') });
  assert.equal(client.timeoutMs, 45000);
  assert.equal(client.applyTimeoutMs, 300000);
});

test('ambiguous apply timeout reconciles a completed write from upstream history', async () => {
  const startedAt = new Date().toISOString();
  const calls = [];
  const client = new HomeEasySyncClient({
    applyReconcileAttempts: 1,
    applyReconcileDelayMs: 0,
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.tipo);
      if (request.tipo === 'COSTOS_SYNC_APPLY') throw new Error('socket closed after write');
      return response(JSON.stringify({
        status: 'ok',
        items: [{
          id: 'history-237',
          type: 'CATALOG_APPLY',
          scanId: 'scan-237',
          state: 'APLICADO',
          changes: 237,
          at: startedAt,
          qa: JSON.stringify({ ok: true, checked: 237, errors: [] }),
          revertedBy: ''
        }]
      }));
    }
  });

  const result = await client.applyCatalog(
    { id: 'scan-237', checkedAt: startedAt },
    [{ kind: 'RENAME', certified: true }],
    { serviceKey: 'key', deviceId: 'device' }
  );

  assert.deepEqual(calls, ['COSTOS_SYNC_APPLY', 'COSTOS_SYNC_HISTORY']);
  assert.equal(result.status, 'ok');
  assert.equal(result.historyId, 'history-237');
  assert.equal(result.changed, 237);
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.qa, { ok: true, checked: 237, errors: [] });
});

test('ambiguous apply timeout never accepts stale history from an earlier request', async () => {
  const calls = [];
  const client = new HomeEasySyncClient({
    applyReconcileAttempts: 1,
    applyReconcileDelayMs: 0,
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request.tipo);
      if (request.tipo === 'COSTOS_SYNC_APPLY') throw new Error('network down');
      return response(JSON.stringify({
        status: 'ok',
        items: [{
          id: 'old-history',
          type: 'CATALOG_APPLY',
          scanId: 'scan-stale',
          state: 'APLICADO',
          changes: 1,
          at: '2026-01-01T00:00:00.000Z',
          qa: JSON.stringify({ ok: true }),
          revertedBy: ''
        }]
      }));
    }
  });

  await assert.rejects(
    () => client.applyCatalog(
      { id: 'scan-stale', checkedAt: new Date().toISOString() },
      [{ kind: 'RENAME', certified: true }],
      { serviceKey: 'key', deviceId: 'device' }
    ),
    error => error && error.code === 'HOMEEASY_SYNC_UPSTREAM_UNAVAILABLE'
  );
  assert.deepEqual(calls, ['COSTOS_SYNC_APPLY', 'COSTOS_SYNC_HISTORY']);
});
