'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AgentUpdater, versionGreater, sha256 } = require('../src/updater');

test('semantic update comparison never downgrades', () => {
  assert.equal(versionGreater('1.6.0', '1.5.5'), true);
  assert.equal(versionGreater('1.5.5', '1.6.0'), false);
  assert.equal(versionGreater('1.6.0', '1.6.0'), false);
});

test('authenticated update is checksum-verified and launches silent installer', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-updater-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = Buffer.from('signed-installer-payload');
  const calls = [];
  let launched = null;
  const api = {
    async get(route, headers, options) {
      calls.push({ route, headers, options });
      if (route.includes('manifest')) return { version: '1.6.0', sha256: sha256(payload), downloadPath: '/api/pentagrama-agent/update-package?version=1.6.0' };
      return payload;
    }
  };
  const updater = new AgentUpdater({
    api,
    headers: { Authorization: 'Bearer secret' },
    currentVersion: '1.5.5',
    root,
    platform: 'win32',
    spawn(file, args, options) {
      launched = { file, args, options };
      return { unref() {} };
    }
  });
  const result = await updater.installIfAvailable('1.6.0');
  assert.equal(result.started, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.binary, true);
  assert.ok(launched.file.endsWith('HomeEasy-Pentagrama-Agent-1.6.0.exe'));
  assert.deepEqual(launched.args, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS']);
  assert.equal(launched.options.detached, true);
});

test('checksum mismatch is rejected without launching code', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-updater-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = {
    async get(route) {
      if (route.includes('manifest')) return { version: '1.6.0', sha256: 'A'.repeat(64), downloadPath: '/api/pentagrama-agent/update-package?version=1.6.0' };
      return Buffer.from('tampered');
    }
  };
  const updater = new AgentUpdater({ api, currentVersion: '1.5.5', root, platform: 'win32', spawn() { throw new Error('must not launch'); } });
  await assert.rejects(() => updater.installIfAvailable('1.6.0'), error => error.code === 'AGENT_UPDATE_CHECKSUM_MISMATCH');
  const status = JSON.parse(fs.readFileSync(path.join(root, 'update-status.json'), 'utf8'));
  assert.equal(status.state, 'failed');
  assert.equal(status.code, 'AGENT_UPDATE_CHECKSUM_MISMATCH');
});
