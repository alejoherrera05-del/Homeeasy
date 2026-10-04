'use strict';

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.file = path.join(directory, 'agent.log');
    this.maxBytes = Number(options.maxBytes || 2 * 1024 * 1024);
    this.keep = Number(options.keep || 5);
    fs.mkdirSync(directory, { recursive: true });
  }

  rotate() {
    try {
      if (fs.statSync(this.file).size < this.maxBytes) return;
    } catch (_) { return; }
    for (let index = this.keep - 1; index >= 1; index -= 1) {
      const from = `${this.file}.${index}`;
      const to = `${this.file}.${index + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(this.file, `${this.file}.1`);
  }

  write(level, event, fields = {}) {
    this.rotate();
    const safe = {};
    for (const [key, value] of Object.entries(fields)) {
      if (/password|credential|secret|token|cookie|payload|result/i.test(key)) continue;
      safe[key] = typeof value === 'string' ? value.slice(0, 300) : value;
    }
    fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date().toISOString(), level, event, ...safe })}\n`);
  }

  info(event, fields) { this.write('info', event, fields); }
  warn(event, fields) { this.write('warn', event, fields); }
  error(event, fields) { this.write('error', event, fields); }
}

module.exports = Object.freeze({ Logger });
