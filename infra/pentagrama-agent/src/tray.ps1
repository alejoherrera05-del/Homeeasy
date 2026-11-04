Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'SilentlyContinue'
$dataRoot = Join-Path $env:ProgramData 'HomeEasy\PentagramaAgent'
$healthPath = Join-Path $dataRoot 'runtime-health.json'
$updatePath = Join-Path $dataRoot 'update-status.json'
$browserPath = Join-Path $dataRoot 'browser-bridge-status.json'
$appRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$iconPath = Join-Path $appRoot 'assets\homeeasy-agent.ico'
$logoPath = Join-Path $appRoot 'assets\homeeasy-logo.png'
$script:lastUpdateNotice = ''
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'HomeEasyPentagramaAgentTray', [ref]$createdNew)
if (-not $createdNew) { exit 0 }

function Read-JsonFile([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-AgentState {
  $health = Read-JsonFile $healthPath
  $update = Read-JsonFile $updatePath
  $browser = Read-JsonFile $browserPath
  $browserConnected = $false
  if ($browser -and $browser.updatedAt) {
    try { $browserConnected = [bool]$browser.connected -and (((Get-Date) - ([DateTimeOffset]::Parse($browser.updatedAt).LocalDateTime)).TotalSeconds -lt 120) } catch {}
  }
  $fresh = $false
  if ($health -and $health.updatedAt) {
    try { $fresh = ((Get-Date) - ([DateTimeOffset]::Parse($health.updatedAt).LocalDateTime)).TotalSeconds -lt 120 } catch {}
  }
  if (-not $fresh) {
    return @{ Level='error'; Title='Agente desconectado'; Detail='El servicio no está enviando heartbeat.'; Health=$health; Update=$update; BrowserConnected=$browserConnected }
  }
  if ($health.status -eq 'recovering' -or $health.code) {
    return @{ Level='warning'; Title='Agente reconectando'; Detail=('Código: ' + [string]$health.code); Health=$health; Update=$update; BrowserConnected=$browserConnected }
  }
  if ($health.status -eq 'running') {
    return @{ Level='working'; Title='Agente trabajando'; Detail=('Proceso: ' + [string]$health.jobType); Health=$health; Update=$update; BrowserConnected=$browserConnected }
  }
  return @{ Level='ok'; Title='Agente activado'; Detail='Conectado y listo para Pentagrama.'; Health=$health; Update=$update; BrowserConnected=$browserConnected }
}

function Open-External([string]$Target) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Target
  $info.UseShellExecute = $true
  [System.Diagnostics.Process]::Start($info) | Out-Null
}

$burgundy = [System.Drawing.ColorTranslator]::FromHtml('#9D3456')
$gold = [System.Drawing.ColorTranslator]::FromHtml('#D4AF37')
$soft = [System.Drawing.ColorTranslator]::FromHtml('#F8F3F5')
$text = [System.Drawing.ColorTranslator]::FromHtml('#2D2530')

$form = New-Object System.Windows.Forms.Form
$form.Text = 'HomeEasy · Pentagrama Agent'
$form.Size = New-Object System.Drawing.Size(520, 330)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::White
if (Test-Path -LiteralPath $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }

$header = New-Object System.Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = 88
$header.BackColor = $burgundy
$form.Controls.Add($header)

$picture = New-Object System.Windows.Forms.PictureBox
$picture.Location = New-Object System.Drawing.Point(18, 12)
$picture.Size = New-Object System.Drawing.Size(64, 64)
$picture.SizeMode = 'Zoom'
if (Test-Path -LiteralPath $logoPath) { $picture.Image = [System.Drawing.Image]::FromFile($logoPath) }
$header.Controls.Add($picture)

$brand = New-Object System.Windows.Forms.Label
$brand.Text = 'HomeEasy'
$brand.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18)
$brand.ForeColor = [System.Drawing.Color]::White
$brand.AutoSize = $true
$brand.Location = New-Object System.Drawing.Point(94, 14)
$header.Controls.Add($brand)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Pentagrama Agent'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(235, 218, 225)
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(96, 51)
$header.Controls.Add($subtitle)

$card = New-Object System.Windows.Forms.Panel
$card.Location = New-Object System.Drawing.Point(22, 108)
$card.Size = New-Object System.Drawing.Size(460, 112)
$card.BackColor = $soft
$form.Controls.Add($card)

$dot = New-Object System.Windows.Forms.Label
$dot.Text = '●'
$dot.Font = New-Object System.Drawing.Font('Segoe UI', 20)
$dot.AutoSize = $true
$dot.Location = New-Object System.Drawing.Point(18, 18)
$card.Controls.Add($dot)

$statusTitle = New-Object System.Windows.Forms.Label
$statusTitle.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 13)
$statusTitle.ForeColor = $text
$statusTitle.AutoSize = $true
$statusTitle.Location = New-Object System.Drawing.Point(58, 18)
$card.Controls.Add($statusTitle)

$statusDetail = New-Object System.Windows.Forms.Label
$statusDetail.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$statusDetail.ForeColor = [System.Drawing.Color]::DimGray
$statusDetail.AutoSize = $true
$statusDetail.Location = New-Object System.Drawing.Point(61, 52)
$card.Controls.Add($statusDetail)

$versionLabel = New-Object System.Windows.Forms.Label
$versionLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$versionLabel.ForeColor = [System.Drawing.Color]::DimGray
$versionLabel.AutoSize = $true
$versionLabel.Location = New-Object System.Drawing.Point(61, 76)
$card.Controls.Add($versionLabel)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = 'Abrir HomeEasy'
$openButton.Size = New-Object System.Drawing.Size(145, 36)
$openButton.Location = New-Object System.Drawing.Point(22, 242)
$openButton.BackColor = $burgundy
$openButton.ForeColor = [System.Drawing.Color]::White
$openButton.FlatStyle = 'Flat'
$openButton.FlatAppearance.BorderSize = 0
$openButton.Add_Click({ Open-External 'https://hommy.homeeasy.com.co/configuracion.html?section=pentagrama' })
$form.Controls.Add($openButton)

$logsButton = New-Object System.Windows.Forms.Button
$logsButton.Text = 'Ver diagnóstico'
$logsButton.Size = New-Object System.Drawing.Size(145, 36)
$logsButton.Location = New-Object System.Drawing.Point(178, 242)
$logsButton.FlatStyle = 'Flat'
$logsButton.FlatAppearance.BorderColor = $gold
$logsButton.Add_Click({ Open-External (Join-Path $dataRoot 'logs') })
$form.Controls.Add($logsButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = 'Cerrar'
$closeButton.Size = New-Object System.Drawing.Size(90, 36)
$closeButton.Location = New-Object System.Drawing.Point(392, 242)
$closeButton.Add_Click({ $form.Hide() })
$form.Controls.Add($closeButton)

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('Comprobando estado…')
$statusItem.Enabled = $false
$menu.Items.Add('-') | Out-Null
$showItem = $menu.Items.Add('Ver estado')
$showItem.Add_Click({ $form.Show(); $form.Activate() })
$homeItem = $menu.Items.Add('Abrir HomeEasy')
$homeItem.Add_Click({ Open-External 'https://hommy.homeeasy.com.co/configuracion.html?section=pentagrama' })
$updateItem = $menu.Items.Add('Actualizaciones automáticas activas')
$updateItem.Enabled = $false
$menu.Items.Add('-') | Out-Null
$exitItem = $menu.Items.Add('Cerrar icono')

$notify = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path -LiteralPath $iconPath) { $notify.Icon = New-Object System.Drawing.Icon($iconPath) }
$notify.Text = 'HomeEasy Pentagrama Agent'
$notify.ContextMenuStrip = $menu
$notify.Visible = $true
$notify.Add_DoubleClick({ $form.Show(); $form.Activate() })
$exitItem.Add_Click({ $notify.Visible = $false; $form.Close(); [System.Windows.Forms.Application]::Exit() })
$form.Add_FormClosing({ param($sender, $eventArgs) if ($eventArgs.CloseReason -eq 'UserClosing') { $eventArgs.Cancel = $true; $form.Hide() } })

function Refresh-Ui {
  $state = Get-AgentState
  $statusTitle.Text = $state.Title
  $statusDetail.Text = $state.Detail
  $version = if ($state.Health -and $state.Health.version) { [string]$state.Health.version } else { 'desconocida' }
  $extensionText = if ($state.BrowserConnected) { 'extensión conectada' } else { 'extensión instalándose o esperando navegador' }
  $versionLabel.Text = 'Versión ' + $version + ' · ' + $extensionText
  $statusItem.Text = $state.Title
  switch ($state.Level) {
    'ok' { $dot.ForeColor = [System.Drawing.Color]::SeaGreen }
    'working' { $dot.ForeColor = $gold }
    'warning' { $dot.ForeColor = [System.Drawing.Color]::DarkOrange }
    default { $dot.ForeColor = [System.Drawing.Color]::Firebrick }
  }
  $notify.Text = ('HomeEasy · ' + $state.Title).Substring(0, [Math]::Min(63, ('HomeEasy · ' + $state.Title).Length))

  if ($state.Update -and $state.Update.updatedAt) {
    $noticeKey = [string]$state.Update.state + ':' + [string]$state.Update.availableVersion + ':' + [string]$state.Update.updatedAt
    if ($noticeKey -ne $script:lastUpdateNotice) {
      $script:lastUpdateNotice = $noticeKey
      if ($state.Update.state -eq 'downloading') {
        $notify.BalloonTipTitle = 'Nueva actualización HomeEasy'
        $notify.BalloonTipText = ('Descargando versión ' + [string]$state.Update.availableVersion + ' de forma segura.')
        $notify.BalloonTipIcon = 'Info'
        $notify.ShowBalloonTip(5000)
      } elseif ($state.Update.state -eq 'installing') {
        $notify.BalloonTipTitle = 'Actualizando HomeEasy'
        $notify.BalloonTipText = 'El Agent se reiniciará automáticamente. No necesitas hacer nada.'
        $notify.BalloonTipIcon = 'Info'
        $notify.ShowBalloonTip(5000)
      } elseif ($state.Update.state -eq 'failed') {
        $notify.BalloonTipTitle = 'Actualización pendiente'
        $notify.BalloonTipText = 'HomeEasy volverá a intentarlo automáticamente.'
        $notify.BalloonTipIcon = 'Warning'
        $notify.ShowBalloonTip(5000)
      }
    }
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Refresh-Ui })
$timer.Start()
Refresh-Ui
$notify.BalloonTipTitle = 'HomeEasy Pentagrama Agent'
$notify.BalloonTipText = 'El agente está activo y se actualizará automáticamente.'
$notify.BalloonTipIcon = 'Info'
$notify.ShowBalloonTip(4000)
[System.Windows.Forms.Application]::Run()

$notify.Dispose()
if ($picture.Image) { $picture.Image.Dispose() }
$mutex.ReleaseMutex()
$mutex.Dispose()
