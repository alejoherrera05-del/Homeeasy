'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { AgentApi } = require('../src/api');

test('Agent API appends the private CA without replacing public TLS roots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-api-'));
  const certificate = 'private-homeeasy-ca';
  const caPath = path.join(directory, 'server.crt');
  fs.writeFileSync(caPath, certificate);
  const api = new AgentApi({ serverUrl: 'https://hommy.homeeasy.com.co', caPath });
  assert.equal(Array.isArray(api.ca), true);
  assert.equal(api.ca.length, tls.rootCertificates.length + 1);
  assert.equal(String(api.ca.at(-1)), certificate);
});
