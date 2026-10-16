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
