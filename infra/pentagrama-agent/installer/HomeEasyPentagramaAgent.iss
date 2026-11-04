#define AgentVersion "1.6.4"
#include "..\build\stage\browser-extension.iss"

[Setup]
AppId={{8C098243-2B7A-493C-A711-9B33F08528A7}
AppName=HomeEasy Pentagrama Agent
AppVersion={#AgentVersion}
AppPublisher=HomeEasy
AppPublisherURL=https://homeeasy.com.co
AppSupportURL=https://hommy.homeeasy.com.co/configuracion.html?section=pentagrama
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
SetupIconFile=..\build\stage\assets\homeeasy-agent.ico
UninstallDisplayIcon={app}\assets\homeeasy-agent.ico
UninstallDisplayName=HomeEasy Pentagrama Agent
SetupLogging=yes
CloseApplications=force
RestartApplications=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "..\build\stage\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\stage\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\stage\HomeEasyPentagramaAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\stage\HomeEasyPentagramaAgent.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\stage\HomeEasyPentagramaAgent.UI.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\stage\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{commonstartup}\HomeEasy Pentagrama Agent"; Filename: "{app}\HomeEasyPentagramaAgent.UI.exe"; Parameters: "--startup"; WorkingDir: "{app}"; IconFilename: "{app}\assets\homeeasy-agent.ico"
Name: "{group}\HomeEasy Pentagrama Agent"; Filename: "{app}\HomeEasyPentagramaAgent.UI.exe"; WorkingDir: "{app}"; IconFilename: "{app}\assets\homeeasy-agent.ico"

[Registry]
Root: HKLM; Subkey: "Software\Policies\Google\Chrome\ExtensionInstallForcelist"; ValueType: string; ValueName: "99"; ValueData: "{#BrowserExtensionId};http://127.0.0.1:38461/extension/update.xml"; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"; ValueType: string; ValueName: "99"; ValueData: "{#BrowserExtensionId};http://127.0.0.1:38461/extension/update.xml"; Flags: uninsdeletevalue
Root: HKLM; Subkey: "Software\Policies\BraveSoftware\Brave\ExtensionInstallForcelist"; ValueType: string; ValueName: "99"; ValueData: "{#BrowserExtensionId};http://127.0.0.1:38461/extension/update.xml"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Instalando servicio HomeEasy Pentagrama Agent..."; Check: not ServiceExists
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "start"; Flags: runhidden waituntilterminated; StatusMsg: "Iniciando HomeEasy Pentagrama Agent..."
Filename: "{app}\HomeEasyPentagramaAgent.UI.exe"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent; Description: "Abrir HomeEasy Pentagrama Agent"

[UninstallRun]
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{app}\HomeEasyPentagramaAgent.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated skipifdoesntexist

[Code]
function ServiceExists(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\sc.exe'), 'query HomeEasyPentagramaAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{app}\HomeEasyPentagramaAgent.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
