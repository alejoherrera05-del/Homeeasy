'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startPowerGuard, POWERSHELL_SCRIPT } = require('../src/power-guard');

test('power guard starts a hidden Windows helper and stops it with the job', () => {
  let executable;
  let args;
  let spawnOptions;
  let killed = 0;
  const child = new EventEmitter();
  child.pid = 4321;
  child.kill = () => { killed += 1; };
  const guard = startPowerGuard({
    platform: 'win32',
    spawnProcess(file, parameters, options) {
      executable = file;
      args = parameters;
      spawnOptions = options;
      return child;
    }
  });

  assert.equal(guard.active, true);
  assert.equal(guard.pid, 4321);
  assert.equal(executable, 'powershell.exe');
  assert.equal(args.includes('-WindowStyle'), true);
  assert.equal(args.includes('Hidden'), true);
  assert.equal(spawnOptions.windowsHide, true);
  const encoded = args[args.indexOf('-EncodedCommand') + 1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le').includes('SetThreadExecutionState'), true);

  guard.stop();
  guard.stop();
  assert.equal(killed, 1);
});

test('power guard is a no-op outside Windows or when explicitly disabled', () => {
  let spawned = 0;
  const spawnProcess = () => { spawned += 1; };
  assert.equal(startPowerGuard({ platform: 'linux', spawnProcess }).active, false);
  assert.equal(startPowerGuard({ platform: 'win32', enabled: false, spawnProcess }).active, false);
  assert.equal(spawned, 0);
});

test('power guard script only requests system wakefulness and restores the default', () => {
  assert.match(POWERSHELL_SCRIPT, /systemRequired/);
  assert.doesNotMatch(POWERSHELL_SCRIPT, /displayRequired/i);
  assert.match(POWERSHELL_SCRIPT, /finally/);
});
