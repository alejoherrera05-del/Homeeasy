'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Phase2Store {
  constructor(options = {}) {
    this.file = path.join(String(options.dataDir || process.env.DATA_DIR || '/app/data'), 'pentagrama-sync-phase2.json');
    this.state = { scans: [], operations: [], history: [], nextScheduledCheck: null, scheduler: { lock: null, lastPeriod: null, lastRunAt: null, lastResult: null } };
    this.load();
  }

  load() {
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch (_) {}
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  operation(type, actor) {
    const value = { id: crypto.randomUUID(), type, state: 'queued', stage: 'QUEUED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), actor: actor || null };
    this.state.operations.unshift(value); this.state.operations = this.state.operations.slice(0, 100); this.save(); return value;
  }

  updateOperation(id, patch) {
    const value = this.state.operations.find(item => item.id === id);
    if (!value) return null;
    Object.assign(value, patch, { updatedAt: new Date().toISOString() }); this.save(); return value;
  }

  addScan(scan) { this.state.scans.unshift(scan); this.state.scans = this.state.scans.slice(0, 24); this.save(); return scan; }
  scan(id) { return this.state.scans.find(item => item.id === id) || null; }
  operationById(id) { return this.state.operations.find(item => item.id === id) || null; }
  addHistory(value) { this.state.history.unshift(value); this.state.history = this.state.history.slice(0, 100); this.save(); }
  publicHistory() { return this.state.history.slice(0, 50); }
  latestScan() { return this.state.scans[0] || null; }

  schedulerState() {
    this.state.scheduler = { lock: null, lastPeriod: null, lastRunAt: null, lastResult: null, ...(this.state.scheduler || {}) };
    return this.state.scheduler;
  }

  acquireSchedulerLock(period, owner, now = Date.now(), leaseMs = 60 * 60 * 1000) {
    const scheduler = this.schedulerState();
    const lockExpiresAt = Date.parse(scheduler.lock && scheduler.lock.expiresAt || '') || 0;
    if (scheduler.lastPeriod === period || lockExpiresAt > now) return false;
    scheduler.lock = { owner, period, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + leaseMs).toISOString() };
    this.save();
    return true;
  }

  finishScheduledRun(period, result, now = Date.now()) {
    const scheduler = this.schedulerState();
    scheduler.lock = null;
    scheduler.lastPeriod = period;
    scheduler.lastRunAt = new Date(now).toISOString();
    scheduler.lastResult = result;
    this.save();
  }

  releaseSchedulerLock(owner) {
    const scheduler = this.schedulerState();
    if (scheduler.lock && scheduler.lock.owner === owner) { scheduler.lock = null; this.save(); }
  }
}

module.exports = Object.freeze({ Phase2Store });
