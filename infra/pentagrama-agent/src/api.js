'use strict';

const fs = require('fs');
const https = require('https');

class AgentApi {
  constructor(options) {
    this.baseUrl = new URL(options.serverUrl);
    this.ca = fs.readFileSync(options.caPath);
    this.timeoutMs = Number(options.timeoutMs || 40000);
  }

  post(route, body, headers = {}) {
    const data = Buffer.from(JSON.stringify(body || {}));
    const url = new URL(route, this.baseUrl);
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'POST',
        ca: this.ca,
        rejectUnauthorized: true,
        timeout: this.timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { return reject(Object.assign(new Error('Agent gateway returned non-JSON'), { code: 'AGENT_TRANSPORT_ERROR' })); }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(Object.assign(new Error(parsed.error || `Agent gateway HTTP ${response.statusCode}`), { code: parsed.code || 'AGENT_TRANSPORT_ERROR', statusCode: response.statusCode }));
          }
          resolve(parsed);
        });
      });
      request.on('timeout', () => request.destroy(Object.assign(new Error('Agent gateway timeout'), { code: 'AGENT_TRANSPORT_ERROR' })));
      request.on('error', error => reject(Object.assign(error, { code: error.code || 'AGENT_TRANSPORT_ERROR' })));
      request.end(data);
    });
  }

  get(route, headers = {}, options = {}) {
    const url = new URL(route, this.baseUrl);
    const maxBytes = Math.max(1024, Number(options.maxBytes || 5 * 1024 * 1024));
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'GET',
        ca: this.ca,
        rejectUnauthorized: true,
        timeout: this.timeoutMs,
        headers
      }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) request.destroy(Object.assign(new Error('Agent gateway response is too large'), { code: 'AGENT_TRANSPORT_ERROR' }));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          const payload = Buffer.concat(chunks);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            let parsed = {};
            try { parsed = JSON.parse(payload.toString('utf8')); } catch (_) {}
            return reject(Object.assign(new Error(parsed.error || `Agent gateway HTTP ${response.statusCode}`), { code: parsed.code || 'AGENT_TRANSPORT_ERROR', statusCode: response.statusCode }));
          }
          if (options.binary) return resolve(payload);
          try { resolve(JSON.parse(payload.toString('utf8'))); }
          catch (_) { reject(Object.assign(new Error('Agent gateway returned non-JSON'), { code: 'AGENT_TRANSPORT_ERROR' })); }
        });
      });
      request.on('timeout', () => request.destroy(Object.assign(new Error('Agent gateway timeout'), { code: 'AGENT_TRANSPORT_ERROR' })));
      request.on('error', error => reject(Object.assign(error, { code: error.code || 'AGENT_TRANSPORT_ERROR' })));
      request.end();
    });
  }
}

module.exports = Object.freeze({ AgentApi });
