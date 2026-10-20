'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { healthIsStale, restartDelay } = require('../src/supervisor');

test('supervisor detects a missing or stale child health file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-supervisor-'));
  const file = path.join(directory, 'runtime-health.json');
  assert.equal(healthIsStale(file, Date.now(), 1000), true);
  fs.writeFileSync(file, '{}');
  const now = Date.now();
  fs.utimesSync(file, new Date(now - 5000), new Date(now - 5000));
  assert.equal(healthIsStale(file, now, 1000), true);
  assert.equal(healthIsStale(file, now, 10000), false);
});

test('supervisor restart backoff is bounded', () => {
  assert.equal(restartDelay(1), 1000);
  assert.equal(restartDelay(2), 2000);
  assert.equal(restartDelay(99), 60000);
});
