'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'session-bridge-extension', 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'session-bridge-extension', 'manifest.json'), 'utf8'));

test('browser transport bounds portal fetches and retries transient failures', () => {
  assert.match(background, /AbortController/);
  assert.match(background, /PENTAGRAMA_BROWSER_REQUEST_TIMEOUT/);
  assert.match(background, /const maxAttempts = 3/);
  assert.match(background, /await sleep\(350 \* attempt\)/);
});

test('session bridge extension version is 1.0.1', () => {
  assert.equal(manifest.version, '1.0.3');
});


test('automatic re-login is not blocked by stale sessionStorage and uses a fresh login URL', () => {
  const content = fs.readFileSync(path.join(root, 'session-bridge-extension', 'content.js'), 'utf8');
  assert.doesNotMatch(content, /homeeasy-login-attempted/);
  assert.match(background, /freshLoginUrl/);
  assert.match(background, /searchParams\.set\('ha'/);
});


test('CAPTCHA is detected and auto-submit is suppressed', () => {
  const content = fs.readFileSync(path.join(root, 'session-bridge-extension', 'content.js'), 'utf8');
  assert.match(content, /CaptchaValue/);
  assert.match(content, /HOMEEASY_CAPTCHA_REQUIRED/);
  assert.match(background, /PENTAGRAMA_CAPTCHA_REQUIRED/);
  assert.match(background, /waitForManualCaptcha/);
  assert.match(background, /setBadgeText\(\{ text: 'CAP' \}\)/);
});
