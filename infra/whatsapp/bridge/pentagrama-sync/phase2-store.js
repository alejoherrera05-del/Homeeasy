'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Phase2Store {
  constructor(options = {}) {
    this.file = path.join(String(options.dataDir || process.env.DATA_DIR || '/app/data'), 'pentagrama-sync-phase2.json');
    this.state = { scans: [], operations: [], history: [], nextScheduledCheck: null };
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
}

module.exports = Object.freeze({ Phase2Store });
