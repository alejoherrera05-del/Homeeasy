'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.HOMEEASY_AGENT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-test-'));
const { decryptEnvelope, publicError, runJob } = require('../src/agent');
const { Logger } = require('../src/logger');

test('agent decrypts the hybrid registration envelope', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ agentToken: 'token', pentagrama: { login: 'x' } })), cipher.final()]);
  const sealed = {
    key: crypto.publicEncrypt({ key: keys.publicKey, oaepHash: 'sha256' }, contentKey).toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
  assert.equal(decryptEnvelope(sealed, keys.privateKey).agentToken, 'token');
});

test('agent executes only health and getPrice jobs', async () => {
  const sync = {
    client: { get: async route => route === '/Order/GetJsonCategoryList' ? [] : null },
    pricing: { supplierCost: async () => ({ basePrice: 244800, total: 244800 }) }
  };
  assert.equal((await runJob({ type: 'health' }, sync)).ok, true);
  assert.equal((await runJob({ type: 'getPrice', payload: { params: {} } }, sync)).basePrice, 244800);
  await assert.rejects(() => runJob({ type: 'shell' }, sync), error => error.code === 'AGENT_JOB_NOT_ALLOWED');
});

test('logs redact secret-shaped fields and rotate safely', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homeeasy-agent-log-'));
  const logger = new Logger(directory, { maxBytes: 80, keep: 2 });
  logger.info('test', { hostname: 'PC', password: 'never-log-this', token: 'never-log-this' });
  logger.info('test2', { hostname: 'PC2' });
  const combined = fs.readdirSync(directory).map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('');
  assert.equal(combined.includes('never-log-this'), false);
});

test('error classification marks transport failures but not credential rejection', () => {
  assert.equal(publicError({ code: 'ETIMEDOUT', message: 'timeout' }).infrastructure, true);
  assert.equal(publicError({ code: 'PENTAGRAMA_SESSION_EXPIRED', message: 'bad credentials' }).infrastructure, false);
});
