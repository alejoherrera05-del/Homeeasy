'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function versionParts(value) {
  return String(value || '').split('.').map(part => Number(String(part).match(/^\d+/)?.[0] || 0)).slice(0, 3).concat([0, 0, 0]).slice(0, 3);
}

function versionGreater(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return true;
    if (a[index] < b[index]) return false;
  }
  return false;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function writeStatus(file, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

class AgentUpdater {
  constructor(options = {}) {
    this.api = options.api;
    this.headers = options.headers || {};
    this.currentVersion = String(options.currentVersion || '0.0.0');
    this.root = String(options.root || process.cwd());
    this.statusPath = String(options.statusPath || path.join(this.root, 'update-status.json'));
    this.spawn = options.spawn || spawn;
    this.platform = options.platform || process.platform;
    this.running = false;
  }

  async installIfAvailable(advertisedVersion) {
    if (this.running || !versionGreater(advertisedVersion, this.currentVersion)) return { started: false };
    this.running = true;
    try {
      writeStatus(this.statusPath, { state: 'checking', currentVersion: this.currentVersion, availableVersion: advertisedVersion });
      const manifest = await this.api.get('/api/pentagrama-agent/update-manifest', this.headers);
      if (!manifest || !versionGreater(manifest.version, this.currentVersion) || String(manifest.version) !== String(advertisedVersion)) {
        throw Object.assign(new Error('Update manifest does not match the advertised version'), { code: 'AGENT_UPDATE_MANIFEST_INVALID' });
      }
      if (!/^[A-Fa-f0-9]{64}$/.test(String(manifest.sha256 || '')) || !String(manifest.downloadPath || '').startsWith('/api/pentagrama-agent/update-package')) {
        throw Object.assign(new Error('Update manifest is incomplete'), { code: 'AGENT_UPDATE_MANIFEST_INVALID' });
      }

      writeStatus(this.statusPath, { state: 'downloading', currentVersion: this.currentVersion, availableVersion: manifest.version });
      const payload = await this.api.get(manifest.downloadPath, this.headers, { binary: true, maxBytes: 150 * 1024 * 1024 });
      if (sha256(payload) !== String(manifest.sha256).toUpperCase()) {
        throw Object.assign(new Error('Update package checksum mismatch'), { code: 'AGENT_UPDATE_CHECKSUM_MISMATCH' });
      }

      const directory = path.join(this.root, 'updates');
      fs.mkdirSync(directory, { recursive: true });
      const installer = path.join(directory, `HomeEasy-Pentagrama-Agent-${manifest.version}.exe`);
      fs.writeFileSync(installer, payload, { mode: 0o700 });
      writeStatus(this.statusPath, { state: 'installing', currentVersion: this.currentVersion, availableVersion: manifest.version });

      if (this.platform !== 'win32') return { started: false, installer, reason: 'UNSUPPORTED_PLATFORM' };
      const child = this.spawn(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      });
      child.unref();
      return { started: true, version: manifest.version, installer };
    } catch (error) {
      writeStatus(this.statusPath, {
        state: 'failed',
        currentVersion: this.currentVersion,
        availableVersion: advertisedVersion,
        code: String(error.code || 'AGENT_UPDATE_FAILED'),
        message: String(error.message || 'Update failed').slice(0, 240)
      });
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = Object.freeze({ AgentUpdater, versionGreater, sha256, writeStatus });
