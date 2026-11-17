'use strict';

const { spawn } = require('child_process');

const POWERSHELL_SCRIPT = `
$source = @'
using System;
using System.Runtime.InteropServices;

public static class HomeEasyAgentPowerGuard
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
'@

Add-Type -TypeDefinition $source
$continuous = [Convert]::ToUInt32('80000000', 16)
$systemRequired = [uint32]1

try {
    while ($true) {
        [void][HomeEasyAgentPowerGuard]::SetThreadExecutionState($continuous -bor $systemRequired)
        Start-Sleep -Seconds 30
    }
}
finally {
    [void][HomeEasyAgentPowerGuard]::SetThreadExecutionState($continuous)
}
`;

function disabledGuard(reason) {
  return Object.freeze({ active: false, reason, stop() {} });
}

function startPowerGuard(options = {}) {
  const platform = String(options.platform || process.platform);
  const enabled = options.enabled === undefined
    ? String(process.env.HOMEEASY_AGENT_POWER_GUARD || '1') !== '0'
    : Boolean(options.enabled);
  if (!enabled) return disabledGuard('disabled');
  if (platform !== 'win32') return disabledGuard('unsupported_platform');

  const spawnProcess = options.spawnProcess || spawn;
  const logger = options.logger || null;
  const encoded = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
  let child;
  try {
    child = spawnProcess('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      encoded
    ], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('power_guard_start_failed', { code: error.code || 'POWER_GUARD_START_FAILED' });
    }
    return disabledGuard('start_failed');
  }

  let stopped = false;
  if (child && typeof child.once === 'function') {
    child.once('error', error => {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('power_guard_failed', { code: error.code || 'POWER_GUARD_FAILED' });
      }
    });
  }

  return Object.freeze({
    active: true,
    get pid() { return Number(child && child.pid || 0); },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        if (child && typeof child.kill === 'function') child.kill();
      } catch (error) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('power_guard_stop_failed', { code: error.code || 'POWER_GUARD_STOP_FAILED' });
        }
      }
    }
  });
}

module.exports = Object.freeze({ startPowerGuard, POWERSHELL_SCRIPT });
