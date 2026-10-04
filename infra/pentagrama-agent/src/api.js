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
}

module.exports = Object.freeze({ AgentApi });
