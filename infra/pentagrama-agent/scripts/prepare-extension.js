'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function extensionId(publicDer) {
  const digest = crypto.createHash('sha256').update(publicDer).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  let value = '';
  for (const byte of digest) value += alphabet[byte >> 4] + alphabet[byte & 15];
  return value;
}

const [, , sourceDirectory, stageDirectory, privateKeyPath, resultPath] = process.argv;
if (!sourceDirectory || !stageDirectory || !privateKeyPath || !resultPath) {
  throw new Error('Usage: prepare-extension <source> <stage> <private-key> <result-json>');
}

fs.cpSync(sourceDirectory, stageDirectory, { recursive: true });
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const publicDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const manifestPath = path.join(stageDirectory, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.key = publicDer.toString('base64');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(resultPath, JSON.stringify({
  id: extensionId(publicDer),
  version: String(manifest.version)
}), 'utf8');
