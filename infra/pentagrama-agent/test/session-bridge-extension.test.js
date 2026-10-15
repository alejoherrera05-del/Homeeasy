'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.join(__dirname, '..', 'session-bridge-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

function extensionIdFromKey(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(String(key), 'base64')).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  let id = '';
  for (const byte of digest) id += alphabet[byte >> 4] + alphabet[byte & 15];
  return id;
}

test('session bridge extension package is complete and has the Agent-pinned identity', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(extensionIdFromKey(manifest.key), 'cmijhfckibhbdhneapoknlbmfadfmogn');

  const background = manifest.background && manifest.background.service_worker;
  assert.equal(background, 'background.js');
  assert.equal(fs.existsSync(path.join(extensionRoot, background)), true);

  const scripts = (manifest.content_scripts || []).flatMap(item => item.js || []);
  assert.ok(scripts.includes('content.js'));
  for (const script of scripts) assert.equal(fs.existsSync(path.join(extensionRoot, script)), true);

  assert.ok((manifest.host_permissions || []).includes('https://pedidos.persianaspentagrama.com/*'));
  assert.ok((manifest.host_permissions || []).includes('http://127.0.0.1:38461/*'));
});

test('extension does not request broad all-sites permission', () => {
  const permissions = manifest.host_permissions || [];
  assert.equal(permissions.includes('<all_urls>'), false);
  assert.equal(permissions.some(value => /^https?:\/\/\*\//.test(value)), false);
});
