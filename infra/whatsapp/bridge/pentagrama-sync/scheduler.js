'use strict';

const crypto = require('crypto');

const TIME_ZONE = 'America/Bogota';
const RUN_HOUR = 3;
const RUN_MINUTE = 15;
const RETRY_DELAYS_MS = Object.freeze([60 * 1000, 5 * 60 * 1000]);
const MAX_TIMER_MS = 12 * 60 * 60 * 1000;

function bogotaParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function periodFor(value) {
  const parts = bogotaParts(value);
  return `${parts.year}-${parts.month}`;
}

function nextMonthlyRun(value = new Date()) {
  const parts = bogotaParts(value);
  let year = Number(parts.year); let month = Number(parts.month);
  const thisMonth = new Date(Date.UTC(year, month - 1, 1, RUN_HOUR + 5, RUN_MINUTE));
  if (thisMonth.getTime() > value.getTime()) return thisMonth;
  month += 1;
  if (month > 12) { month = 1; year += 1; }
  return new Date(Date.UTC(year, month - 1, 1, RUN_HOUR + 5, RUN_MINUTE));
}

function classifyFailure(error) {
  const code = String(error && (error.code || error.message) || 'INTERNAL_ERROR').toUpperCase();
  if (/AGENT_OFFLINE|NO_AGENT/.test(code)) return 'NO_AGENT_AVAILABLE';
  if (/AUTH|LOGIN|CREDENTIAL/.test(code)) return 'AUTH_ERROR';
  if (/ACCESS_BLOCKED|UNAVAILABLE|UNEXPECTED_RESPONSE/.test(code)) return 'PENTAGRAMA_UNAVAILABLE';
  if (/NETWORK|TIMEOUT|TRANSPORT|FETCH/.test(code)) return 'NETWORK_ERROR';
  return 'INTERNAL_ERROR';
}

function changeCounts(counts = {}) {
  return {
    total: Number(counts.INCREASED || 0) + Number(counts.DECREASED || 0) + Number(counts.NEW || 0),
    increases: Number(counts.INCREASED || 0), decreases: Number(counts.DECREASED || 0),
    reviewRequired: Number(counts.REVIEW_REQUIRED || 0), unmapped: Number(counts.UNMAPPED || 0)
  };
}

class PentagramaScheduler {
  constructor(options = {}) {
    this.phase2 = options.phase2;
    this.store = options.store || this.phase2.store;
    this.gateway = options.gateway;
    this.serviceKey = String(options.serviceKey || process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY || '');
    this.now = options.now || (() => new Date());
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.retryDelays = options.retryDelays || RETRY_DELAYS_MS;
    this.timer = null;
  }

  context() {
    return { serviceKey: this.serviceKey, deviceId: 'pentagrama-scheduler', deviceName: 'Pentagrama Scheduler', platform: 'VPS', browser: 'Scheduler' };
  }

  start() { this.scheduleNext(); return this.status(); }
  stop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; }

  scheduleNext() {
    if (this.timer) this.clearTimer(this.timer);
    const now = this.now(); const next = nextMonthlyRun(now);
    this.store.state.nextScheduledCheck = next.toISOString(); this.store.save();
    const remaining = next.getTime() - now.getTime();
    this.timer = this.setTimer(() => {
      const due = this.now().getTime() >= next.getTime();
      return Promise.resolve(due ? this.runDue() : null).finally(() => this.scheduleNext());
    }, Math.max(1000, Math.min(MAX_TIMER_MS, remaining)));
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  status() {
    const scheduler = this.store.schedulerState();
    return { timezone: TIME_ZONE, nextRunAt: this.store.state.nextScheduledCheck, lastRunAt: scheduler.lastRunAt, lastResult: scheduler.lastResult };
  }

  async runDue(options = {}) {
    const started = this.now(); const period = options.period || periodFor(started); const owner = crypto.randomUUID();
    if (!this.serviceKey) return this.recordFailure(period, owner, started, { code: 'SCHEDULER_SERVICE_KEY_MISSING' }, false);
    if (!this.store.acquireSchedulerLock(period, owner, started.getTime())) return { ok: true, skipped: true, code: 'SCHEDULE_ALREADY_PROCESSED' };
    let lastError;
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt += 1) {
      try { return await this.execute(period, owner, started, attempt + 1); }
      catch (error) {
        lastError = error;
        const type = classifyFailure(error);
        if (attempt >= this.retryDelays.length || type === 'AUTH_ERROR' || type === 'INTERNAL_ERROR') break;
        await new Promise(resolve => this.setTimer(resolve, this.retryDelays[attempt]));
      }
    }
    return this.recordFailure(period, owner, started, lastError, true);
  }

  async execute(period, owner, started, attempts) {
    const actor = { email: 'scheduler@homeeasy', nombre: 'Pentagrama Scheduler', internal: true };
    const operation = this.store.operation('auto_scan', actor);
    try { await this.phase2.runScan(operation.id, this.context()); }
    catch (error) { this.phase2.fail(operation.id, error); throw error; }
    const completed = this.store.operationById(operation.id);
    if (!completed || completed.state !== 'completed') throw Object.assign(new Error('Scheduled scan did not complete'), { code: completed && completed.error && completed.error.code || 'AUTO_SCAN_FAILED' });
    const scan = this.store.scan(completed.scanId); const errors = scan.results.filter(item => item.status === 'ERROR');
    if (errors.length) throw Object.assign(new Error('Pentagrama scan returned errors'), { code: errors[0].error || 'AUTO_SCAN_RESULT_ERROR' });
    const counts = changeCounts(scan.counts); const event = counts.total || counts.reviewRequired ? 'CHANGES_DETECTED' : 'AUTO_SCAN_OK';
    const agent = this.agentUsed(started);
    const result = { event, at: this.now().toISOString(), agent, checked: scan.results.length - counts.unmapped, changes: counts.total,
      increases: counts.increases, decreases: counts.decreases, reviewRequired: counts.reviewRequired, unmapped: counts.unmapped,
      durationMs: this.now().getTime() - started.getTime(), attempts, scanId: scan.id };
    this.store.addHistory({ id: crypto.randomUUID(), type: event, at: result.at, scanId: scan.id, changed: counts.total, actor: { nombre: 'Sistema' }, automatic: result });
    this.store.finishScheduledRun(period, result, this.now().getTime());
    return { ok: true, result };
  }

  agentUsed(started) {
    const agents = this.gateway && this.gateway.list ? this.gateway.list() : [];
    const used = agents.filter(item => Date.parse(item.lastJob && item.lastJob.at || '') >= started.getTime()).sort((a, b) => Date.parse(b.lastJob.at) - Date.parse(a.lastJob.at))[0];
    return used ? { installationId: used.installationId, hostname: used.hostname, version: used.version } : null;
  }

  recordFailure(period, owner, started, error, locked) {
    const result = { event: 'AUTO_SCAN_FAILED', at: this.now().toISOString(), errorType: classifyFailure(error), code: String(error && error.code || 'INTERNAL_ERROR'), durationMs: this.now().getTime() - started.getTime() };
    this.store.addHistory({ id: crypto.randomUUID(), type: 'AUTO_SCAN_FAILED', at: result.at, changed: 0, actor: { nombre: 'Sistema' }, automatic: result });
    if (locked) this.store.finishScheduledRun(period, result, this.now().getTime()); else this.store.releaseSchedulerLock(owner);
    return { ok: false, result };
  }
}

module.exports = Object.freeze({ PentagramaScheduler, TIME_ZONE, RUN_HOUR, RUN_MINUTE, RETRY_DELAYS_MS, MAX_TIMER_MS, periodFor, nextMonthlyRun, classifyFailure, changeCounts });
