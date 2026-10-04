param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$EnrollmentToken,
  [Parameter(Mandatory = $true)][string]$CertificatePath,
  [string]$OutputDirectory = '',
  [string]$InnoCompiler = ''
)

$ErrorActionPreference = 'Stop'
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $agentRoot '..\..')
$buildRoot = Join-Path $agentRoot 'build'
$stage = Join-Path $buildRoot 'stage'
$cache = Join-Path $buildRoot 'cache'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $buildRoot 'output' }
if (-not $EnrollmentToken.Trim()) { throw 'EnrollmentToken is required.' }
if (-not (Test-Path -LiteralPath $CertificatePath)) { throw 'CertificatePath does not exist.' }

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage,$cache,$OutputDirectory | Out-Null
$appStage = Join-Path $stage 'app'
$runtimeStage = Join-Path $stage 'runtime'
New-Item -ItemType Directory -Force -Path $appStage,$runtimeStage | Out-Null

$nodeVersion = '22.18.0'
$nodeArchive = Join-Path $cache "node-v$nodeVersion-win-x64.zip"
if (-not (Test-Path -LiteralPath $nodeArchive)) {
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" -OutFile $nodeArchive
}
$nodeExtract = Join-Path $cache "node-v$nodeVersion-win-x64"
if (-not (Test-Path -LiteralPath (Join-Path $nodeExtract 'node.exe'))) {
  Expand-Archive -LiteralPath $nodeArchive -DestinationPath $cache -Force
}
Copy-Item -LiteralPath (Join-Path $nodeExtract 'node.exe') -Destination $runtimeStage
Copy-Item -LiteralPath (Join-Path $nodeExtract 'LICENSE') -Destination (Join-Path $runtimeStage 'NODE-LICENSE.txt')

$winswPath = Join-Path $cache 'WinSW-x64.exe'
if (-not (Test-Path -LiteralPath $winswPath)) {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' -OutFile $winswPath
}
Copy-Item -LiteralPath $winswPath -Destination (Join-Path $stage 'HomeEasyPentagramaAgent.exe')
Copy-Item -LiteralPath (Join-Path $agentRoot 'service\HomeEasyPentagramaAgent.xml') -Destination $stage

Copy-Item -LiteralPath (Join-Path $agentRoot 'package.json') -Destination $appStage
Copy-Item -LiteralPath (Join-Path $agentRoot 'src') -Destination $appStage -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot 'infra\whatsapp\bridge\pentagrama-sync') -Destination (Join-Path $appStage 'core') -Recurse
Copy-Item -LiteralPath $CertificatePath -Destination (Join-Path $appStage 'server.crt')
@{ serverUrl = $ServerUrl; caFile = 'server.crt' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appStage 'config.json') -Encoding utf8NoBOM
Set-Content -LiteralPath (Join-Path $appStage 'enrollment.key') -Value $EnrollmentToken -Encoding utf8NoBOM -NoNewline

if (-not $InnoCompiler) {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  )
  $InnoCompiler = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)) { throw 'Inno Setup ISCC.exe was not found.' }

& $InnoCompiler "/O$OutputDirectory" (Join-Path $agentRoot 'installer\HomeEasyPentagramaAgent.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }
$setup = Join-Path $OutputDirectory 'HomeEasy-Pentagrama-Agent-Setup.exe'
if (-not (Test-Path -LiteralPath $setup)) { throw 'Setup executable was not generated.' }
Get-FileHash -Algorithm SHA256 -LiteralPath $setup | Select-Object Path,Hash
