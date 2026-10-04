'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Phase2Store } = require('./phase2-store');
const { PentagramaScheduler, nextMonthlyRun, periodFor, classifyFailure } = require('./scheduler');

function fixture(results, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pentagrama-scheduler-'));
  const store = new Phase2Store({ dataDir: directory });
  const nowValue = new Date(options.now || '2026-10-04T16:00:00.000Z');
  let scans = 0; let applies = 0;
  const phase2 = {
    store,
    async runScan(operationId) {
      scans += 1;
      if (options.error) throw Object.assign(new Error(options.error), { code: options.error });
      const counts = results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
      const scan = { id: `scan-${scans}`, checkedAt: nowValue.toISOString(), expiresAt: new Date(nowValue.getTime() + 1800000).toISOString(), counts, results };
      store.addScan(scan); store.updateOperation(operationId, { state: 'completed', stage: 'COMPLETED', scanId: scan.id });
    },
    fail(operationId, error) { store.updateOperation(operationId, { state: 'failed', error: { code: error.code } }); },
    startApply() { applies += 1; }
  };
  const gateway = { list: () => options.noAgent ? [] : [{ installationId: 'agent-1', hostname: 'OFFICE-PC', version: '1.1.1', lastJob: { at: new Date(nowValue.getTime() + 1).toISOString() } }] };
  const immediate = fn => { fn(); return { unref() {} }; };
  const scheduler = new PentagramaScheduler({ phase2, store, gateway, serviceKey: 'test-key', now: () => new Date(nowValue), retryDelays: [1], setTimer: immediate });
  return { scheduler, store, stats: () => ({ scans, applies }) };
}

test('monthly schedule uses day one at 03:15 America/Bogota', () => {
  assert.equal(nextMonthlyRun(new Date('2026-10-04T16:00:00Z')).toISOString(), '2026-11-01T08:15:00.000Z');
  assert.equal(nextMonthlyRun(new Date('2026-11-01T07:00:00Z')).toISOString(), '2026-11-01T08:15:00.000Z');
  assert.equal(periodFor(new Date('2026-11-01T08:15:00Z')), '2026-11');
});

test('automatic scan records AUTO_SCAN_OK and never applies rates', async () => {
  const value = fixture([{ status: 'UNCHANGED' }, { status: 'UNMAPPED' }]);
  const response = await value.scheduler.runDue({ period: '2026-10' });
  assert.equal(response.result.event, 'AUTO_SCAN_OK');
  assert.equal(response.result.checked, 1);
  assert.equal(value.store.publicHistory()[0].type, 'AUTO_SCAN_OK');
  assert.deepEqual(value.stats(), { scans: 1, applies: 0 });
});

test('automatic scan records detailed CHANGES_DETECTED counts', async () => {
  const value = fixture([{ status: 'INCREASED' }, { status: 'DECREASED' }, { status: 'REVIEW_REQUIRED' }, { status: 'UNMAPPED' }]);
  const response = await value.scheduler.runDue({ period: '2026-10' });
  assert.equal(response.result.event, 'CHANGES_DETECTED');
  assert.deepEqual({ changes: response.result.changes, increases: response.result.increases, decreases: response.result.decreases, review: response.result.reviewRequired, unmapped: response.result.unmapped }, { changes: 2, increases: 1, decreases: 1, review: 1, unmapped: 1 });
});

test('period lock prevents duplicate execution', async () => {
  const value = fixture([{ status: 'UNCHANGED' }]);
  assert.equal(value.store.acquireSchedulerLock('2026-10', 'another-run', Date.parse('2026-10-04T16:00:00Z')), true);
  const response = await value.scheduler.runDue({ period: '2026-10' });
  assert.equal(response.code, 'SCHEDULE_ALREADY_PROCESSED');
  assert.equal(value.stats().scans, 0);
});

test('no agent and Pentagrama failures are classified with bounded retries', async () => {
  const noAgent = fixture([], { error: 'AGENT_OFFLINE' });
  const first = await noAgent.scheduler.runDue({ period: '2026-10' });
  assert.equal(first.result.errorType, 'NO_AGENT_AVAILABLE');
  assert.equal(noAgent.stats().scans, 2);
  const portal = fixture([], { error: 'PENTAGRAMA_ACCESS_BLOCKED' });
  const second = await portal.scheduler.runDue({ period: '2026-10' });
  assert.equal(second.result.errorType, 'PENTAGRAMA_UNAVAILABLE');
  assert.equal(portal.stats().scans, 2);
  assert.equal(classifyFailure({ code: 'PENTAGRAMA_LOGIN_FAILED' }), 'AUTH_ERROR');
  assert.equal(classifyFailure({ code: 'AGENT_TRANSPORT_ERROR' }), 'NETWORK_ERROR');
  assert.equal(classifyFailure({ code: 'UNKNOWN' }), 'INTERNAL_ERROR');
});
