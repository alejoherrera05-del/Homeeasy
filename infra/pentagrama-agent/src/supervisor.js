'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = String(process.env.HOMEEASY_AGENT_DATA || path.join(process.env.ProgramData || 'C:\\ProgramData', 'HomeEasy', 'PentagramaAgent'));
const HEALTH_PATH = String(process.env.HOMEEASY_AGENT_HEALTH_FILE || path.join(ROOT, 'runtime-health.json'));
const AGENT_PATH = path.join(__dirname, 'agent.js');
const CHECK_INTERVAL_MS = Math.max(5000, Number(process.env.HOMEEASY_AGENT_WATCHDOG_INTERVAL_MS || 15000));
const STARTUP_GRACE_MS = Math.max(30000, Number(process.env.HOMEEASY_AGENT_STARTUP_GRACE_MS || 90000));
const STALE_AFTER_MS = Math.max(60000, Number(process.env.HOMEEASY_AGENT_STALE_AFTER_MS || 210000));

let stopping = false;
let child = null;
let childStartedAt = 0;
let restartCount = 0;
let watchdog = null;
let restartTimer = null;

function healthIsStale(file, now = Date.now(), staleAfterMs = STALE_AFTER_MS) {
  try {
    const stat = fs.statSync(file);
    return now - stat.mtimeMs > staleAfterMs;
  } catch (_) {
    return true;
  }
}

function restartDelay(count) {
  return Math.min(60000, 1000 * (2 ** Math.min(Math.max(0, count - 1), 6)));
}

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), component: 'supervisor', event, ...fields })}\n`);
}

function scheduleStart() {
  if (stopping || restartTimer) return;
  const delay = restartDelay(restartCount);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startChild();
  }, delay);
}

function startChild() {
  if (stopping || child) return;
  childStartedAt = Date.now();
  child = spawn(process.execPath, [AGENT_PATH], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOMEEASY_AGENT_HEALTH_FILE: HEALTH_PATH },
    stdio: 'inherit',
    windowsHide: true
  });
  log('child_started', { pid: child.pid, restartCount });
  child.once('exit', (code, signal) => {
    const uptimeMs = Date.now() - childStartedAt;
    log('child_exited', { code, signal, uptimeMs });
    child = null;
    restartCount = uptimeMs >= 5 * 60 * 1000 ? 0 : restartCount + 1;
    scheduleStart();
  });
  child.once('error', error => {
    log('child_error', { code: error.code || 'SPAWN_FAILED' });
  });
}

function inspectChild() {
  if (stopping || !child) return;
  const age = Date.now() - childStartedAt;
  if (age <= STARTUP_GRACE_MS) return;
  if (!healthIsStale(HEALTH_PATH)) return;
  log('child_unresponsive', { pid: child.pid, staleAfterMs: STALE_AFTER_MS });
  child.kill();
}

function stop() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (watchdog) clearInterval(watchdog);
  if (child) child.kill();
}

if (require.main === module) {
  fs.mkdirSync(ROOT, { recursive: true });
  startChild();
  watchdog = setInterval(inspectChild, CHECK_INTERVAL_MS);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = Object.freeze({ healthIsStale, restartDelay });
