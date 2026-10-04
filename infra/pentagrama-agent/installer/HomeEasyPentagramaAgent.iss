#define AgentVersion "1.0.0"

[Setup]
AppId={{8C098243-2B7A-493C-A711-9B33F08528A7}
AppName=HomeEasy Pentagrama Agent
AppVersion={#AgentVersion}
AppPublisher=HomeEasy
DefaultDirName={autopf}\HomeEasy Pentagrama Agent
DefaultGroupName=HomeEasy
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=HomeEasy-Pentagrama-Agent-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=HomeEasy Pentagrama Agent
SetupLogging=yes

[Files]
Source: "..\build\stage\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\stage\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\stage\HomeEasyPentagramaAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\stage\HomeEasyPentagramaAgent.xml"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando servicio HomeEasy Pentagrama Agent..."
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; StatusMsg: "Iniciando HomeEasy Pentagrama Agent..."

[UninstallRun]
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated skipifdoesntexist

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{app}\HomeEasyPentagramaAgent.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
