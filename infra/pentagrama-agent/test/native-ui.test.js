'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const installer = fs.readFileSync(path.join(root, 'installer', 'HomeEasyPentagramaAgent.iss'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.ps1'), 'utf8');
const source = fs.readFileSync(path.join(root, 'ui', 'HomeEasyPentagramaAgent.UI.cs'), 'utf8');

test('installer starts the native WinExe without PowerShell or a console window', () => {
  assert.match(installer, /HomeEasyPentagramaAgent\.UI\.exe/);
  assert.match(installer, /Parameters: "--startup"/);
  assert.doesNotMatch(installer, /tray\.ps1/);
  assert.doesNotMatch(installer, /powershell\.exe/i);
});

test('upgrades reuse the existing Windows service and always restart it', () => {
  assert.match(installer, /Parameters: "install"[^\r\n]+Check: not ServiceExists/);
  assert.match(installer, /function ServiceExists\(\): Boolean/);
  assert.match(installer, /Parameters: "start"/);
});

test('build compiles a DPI-aware native Windows application', () => {
  assert.match(build, /target:winexe/);
  assert.match(build, /win32manifest/);
  assert.match(build, /HomeEasyPentagramaAgent\.UI\.cs/);
});

test('native UI keeps credentials in HomeEasy and exposes safe configuration', () => {
  assert.match(source, /Configurar acceso/);
  assert.match(source, /credenciales protegidas por HomeEasy/i);
  assert.match(source, /configuracion\.html\?section=pentagrama/);
  assert.doesNotMatch(source, /PasswordBox|pentagrama\.password|PENTAGRAMA_PASSWORD/);
});

test('native UI reports agent, browser extension, and automatic updates', () => {
  assert.match(source, /runtime-health\.json/);
  assert.match(source, /browser-bridge-status\.json/);
  assert.match(source, /update-status\.json/);
  assert.match(source, /Nueva actualización HomeEasy/);
});
