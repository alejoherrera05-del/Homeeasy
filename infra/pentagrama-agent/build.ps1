param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$EnrollmentToken,
  [Parameter(Mandatory = $true)][string]$CertificatePath,
  [Parameter(Mandatory = $true)][string]$ExtensionPrivateKeyPath,
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
if (-not (Test-Path -LiteralPath $ExtensionPrivateKeyPath)) { throw 'ExtensionPrivateKeyPath does not exist.' }

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage,$cache,$OutputDirectory | Out-Null
$appStage = Join-Path $stage 'app'
$runtimeStage = Join-Path $stage 'runtime'
$assetsStage = Join-Path $stage 'assets'
New-Item -ItemType Directory -Force -Path $appStage,$runtimeStage,$assetsStage | Out-Null

$logoPath = Join-Path $repoRoot 'logohomeeasy.png'
if (-not (Test-Path -LiteralPath $logoPath)) { throw 'HomeEasy logo was not found.' }
Copy-Item -LiteralPath $logoPath -Destination (Join-Path $assetsStage 'homeeasy-logo.png')
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($logoPath)
$iconBitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.DrawImage($sourceImage, 0, 0, 256, 256)
$pngStream = New-Object System.IO.MemoryStream
$iconBitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$graphics.Dispose()
$iconBitmap.Dispose()
$sourceImage.Dispose()
$pngStream.Dispose()
$iconPath = Join-Path $assetsStage 'homeeasy-agent.ico'
$iconStream = [System.IO.File]::Create($iconPath)
$iconWriter = New-Object System.IO.BinaryWriter($iconStream)
try {
  $iconWriter.Write([UInt16]0)
  $iconWriter.Write([UInt16]1)
  $iconWriter.Write([UInt16]1)
  $iconWriter.Write([Byte]0)
  $iconWriter.Write([Byte]0)
  $iconWriter.Write([Byte]0)
  $iconWriter.Write([Byte]0)
  $iconWriter.Write([UInt16]1)
  $iconWriter.Write([UInt16]32)
  $iconWriter.Write([UInt32]$pngBytes.Length)
  $iconWriter.Write([UInt32]22)
  $iconWriter.Write($pngBytes)
} finally {
  $iconWriter.Dispose()
  $iconStream.Dispose()
}

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
$extensionStage = Join-Path $stage 'browser-extension-source'
Copy-Item -LiteralPath (Join-Path $agentRoot 'session-bridge-extension') -Destination $extensionStage -Recurse
$extensionResultPath = Join-Path $stage 'browser-extension.json'
& node (Join-Path $agentRoot 'scripts\prepare-extension.js') (Join-Path $agentRoot 'session-bridge-extension') $extensionStage $ExtensionPrivateKeyPath $extensionResultPath
if ($LASTEXITCODE -ne 0) { throw "Extension preparation failed with exit code $LASTEXITCODE." }
$extensionResult = Get-Content -LiteralPath $extensionResultPath -Raw | ConvertFrom-Json
$extensionId = [string]$extensionResult.id

$browserCandidates = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
)
$browserPacker = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browserPacker) { throw 'Chrome, Edge or Brave is required to package the HomeEasy extension.' }
$packedCrx = "$extensionStage.crx"
$packedPem = "$extensionStage.pem"
Remove-Item -LiteralPath $packedCrx,$packedPem -Force -ErrorAction SilentlyContinue
& $browserPacker "--pack-extension=$extensionStage" "--pack-extension-key=$ExtensionPrivateKeyPath"
for ($attempt = 0; $attempt -lt 50 -and -not (Test-Path -LiteralPath $packedCrx); $attempt += 1) {
  Start-Sleep -Milliseconds 200
}
if (-not (Test-Path -LiteralPath $packedCrx)) { throw 'Browser extension CRX was not generated.' }
$browserExtensionStage = Join-Path $appStage 'browser-extension'
New-Item -ItemType Directory -Force -Path $browserExtensionStage | Out-Null
Copy-Item -LiteralPath $packedCrx -Destination (Join-Path $browserExtensionStage 'homeeasy-session-bridge.crx')
$extensionVersion = [string]$extensionResult.version
Set-Content -LiteralPath (Join-Path $stage 'browser-extension.iss') -Value "#define BrowserExtensionId `"$extensionId`"" -Encoding ascii
Copy-Item -LiteralPath (Join-Path $repoRoot 'infra\whatsapp\bridge\pentagrama-sync') -Destination (Join-Path $appStage 'core') -Recurse
Copy-Item -LiteralPath $CertificatePath -Destination (Join-Path $appStage 'server.crt')
@{
  serverUrl = $ServerUrl
  caFile = 'server.crt'
  extensionIds = @($extensionId, 'cmijhfckibhbdhneapoknlbmfadfmogn')
  extensionPackage = 'browser-extension/homeeasy-session-bridge.crx'
  extensionVersion = $extensionVersion
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appStage 'config.json') -Encoding utf8NoBOM
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
$package = Get-Content -LiteralPath (Join-Path $agentRoot 'package.json') -Raw | ConvertFrom-Json
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $setup
$manifest = [ordered]@{
  version = [string]$package.version
  fileName = 'HomeEasy-Pentagrama-Agent-Setup.exe'
  sha256 = [string]$hash.Hash
  sizeBytes = [long](Get-Item -LiteralPath $setup).Length
  publishedAt = [DateTime]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'manifest.json') -Encoding utf8NoBOM
$hash | Select-Object Path,Hash
