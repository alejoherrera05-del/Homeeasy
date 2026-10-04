'use strict';

const { spawn } = require('child_process');

// Windows PowerShell 5.1 uses DPAPI CurrentUser by default. The service runs under
// LocalSystem, so encrypted values remain bound to that service identity and machine.
const PROTECT = "$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString $v -AsPlainText -Force;$s|ConvertFrom-SecureString";
const UNPROTECT = "$v=[Console]::In.ReadToEnd();$s=$v|ConvertTo-SecureString;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}";

function run(script, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    let errorOutput = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errorOutput += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`Windows DPAPI failed (${code}): ${errorOutput.slice(0, 120)}`)));
    child.stdin.end(String(value));
  });
}

function protect(value) { return run(PROTECT, value); }
function unprotect(value) { return run(UNPROTECT, value); }

module.exports = Object.freeze({ protect, unprotect });
