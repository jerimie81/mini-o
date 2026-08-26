; ==============================================================================
; Mini-O / Redrum AI - Inno Setup Installer Script for Windows
; Produces: mini-o-setup-0.1.0.exe
; ==============================================================================

#define MyAppName "Mini-O AI Workspace"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Redrum AI Team"
#define MyAppURL "https://github.com/redrum-ai/mini-o"
#define MyAppExeName "start-mini-o.bat"

[Setup]
AppId={{9F821A80-60A4-4D2A-94B6-1E8D9C02B892}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\Mini-O
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=..\README.md
InfoBeforeFile=..\README.md
OutputDir=..\dist
OutputBaseFilename=mini-o-setup-0.1.0
SetupIconFile=mini-o.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ChangesEnvironment=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 6.1; Check: not IsAdminInstallMode
Name: "startup"; Description: "Automatically launch Mini-O background server on Windows startup"; GroupDescription: "Startup Options:"; Flags: unchecked
Name: "addtopath"; Description: "Add Mini-O to system PATH environment variable"; GroupDescription: "Command Line Options:"

[Files]
; Standalone bundle
Source: "..\dist\server.cjs"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\dist\server.cjs.map"; DestDir: "{app}\dist"; Flags: ignoreversion
; Frontend
Source: "..\frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs createallsubdirs
; Windows Launchers and configuration
Source: "mini-o.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "mini-o.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-mini-o.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-ollama.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "mini-o.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.windows.json"; DestDir: "{app}"; DestName: "config.json"; Flags: ignoreversion
Source: "mini-o-service.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "mini-o.ico"; DestDir: "{app}"; Flags: ignoreversion
; Documentation & Samples
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\WINDOWS.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs createallsubdirs onlyifdoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\mini-o.ico"
Name: "{group}\Mini-O Command Line"; Filename: "{cmd}"; Parameters: "/k cd /d ""{app}"" && mini-o.cmd help"; IconFilename: "{app}\mini-o.ico"
Name: "{group}\Mini-O Logs"; Filename: "{cmd}"; Parameters: "/c cd /d ""{app}"" && mini-o.cmd logs"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\mini-o.ico"; Tasks: desktopicon
Name: "{userstartup}\Mini-O"; Filename: "{app}\mini-o.vbs"; Tasks: startup

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: string; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: NeedsAddPath(ExpandConstant('{app}'))

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
var
  OllamaPage: TWizardPage;
  OllamaStatusLabel: TLabel;
  InstallOllamaCheckBox: TNewCheckBox;
  ModelLabel: TLabel;
  ModelComboBox: TNewComboBox;
  ModelDescLabel: TLabel;
  StartOllamaCheckBox: TNewCheckBox;

function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + UpperCase(Param) + ';', ';' + UpperCase(OrigPath) + ';') = 0;
end;

function IsOllamaInstalled(): boolean;
var
  LocalAppPath: string;
  RegPath: string;
begin
  LocalAppPath := ExpandConstant('{localappdata}\Programs\Ollama\ollama.exe');
  if FileExists(LocalAppPath) then
  begin
    Result := True;
    exit;
  end;

  if RegQueryStringValue(HKEY_CURRENT_USER, 'Software\Ollama', 'InstallLocation', RegPath) then
  begin
    if FileExists(RegPath + '\ollama.exe') then
    begin
      Result := True;
      exit;
    end;
  end;

  Result := False;
end;

procedure OnModelChange(Sender: TObject);
begin
  case ModelComboBox.ItemIndex of
    0: ModelDescLabel.Caption := 'Recommended general assistant: balanced reasoning, instructions & speed (~4.7 GB, 8GB RAM).';
    1: ModelDescLabel.Caption := 'Fast & lightweight: optimal for laptops and quick responses (~2.0 GB, 6GB RAM).';
    2: ModelDescLabel.Caption := 'Ultra-compact model: minimal memory footprint and fast inference (~1.3 GB, 4GB RAM).';
    3: ModelDescLabel.Caption := 'Dedicated code assistant: high accuracy for programming and shell workflows (~4.7 GB, 8GB RAM).';
    4: ModelDescLabel.Caption := 'High-precision reasoning: strong instruction-following and document analysis (~4.1 GB, 8GB RAM).';
    5: ModelDescLabel.Caption := 'Compact Microsoft model: strong reasoning-to-size performance (~2.2 GB, 6GB RAM).';
    6: ModelDescLabel.Caption := 'Deep chain-of-thought reasoning: step-by-step logic breakdown (~4.9 GB, 8GB RAM).';
    7: ModelDescLabel.Caption := 'Do not download a model now. You can download or select models later in Mini-O Settings.';
  end;
end;

procedure InitializeWizard;
begin
  OllamaPage := CreateCustomPage(wpSelectTasks,
    'Ollama Local AI & Model Setup',
    'Configure private offline intelligence and choose your initial AI companion model.');

  OllamaStatusLabel := TLabel.Create(OllamaPage);
  OllamaStatusLabel.Parent := OllamaPage.Surface;
  OllamaStatusLabel.Left := ScaleX(0);
  OllamaStatusLabel.Top := ScaleY(0);
  OllamaStatusLabel.Width := ScaleX(400);

  if IsOllamaInstalled() then
  begin
    OllamaStatusLabel.Caption := 'Ollama Status: Detected on this system.';
    OllamaStatusLabel.Font.Color := clGreen;
  end
  else
  begin
    OllamaStatusLabel.Caption := 'Ollama Status: Not detected. Mini-O can install it automatically for you.';
    OllamaStatusLabel.Font.Color := clNavy;
  end;

  InstallOllamaCheckBox := TNewCheckBox.Create(OllamaPage);
  InstallOllamaCheckBox.Parent := OllamaPage.Surface;
  InstallOllamaCheckBox.Left := ScaleX(0);
  InstallOllamaCheckBox.Top := ScaleY(26);
  InstallOllamaCheckBox.Width := ScaleX(420);
  InstallOllamaCheckBox.Caption := 'Download and install Ollama for Windows automatically (Recommended)';
  InstallOllamaCheckBox.Checked := not IsOllamaInstalled();

  ModelLabel := TLabel.Create(OllamaPage);
  ModelLabel.Parent := OllamaPage.Surface;
  ModelLabel.Left := ScaleX(0);
  ModelLabel.Top := ScaleY(60);
  ModelLabel.Caption := 'Select initial AI model to download and set as default:';
  ModelLabel.Font.Style := [fsBold];

  ModelComboBox := TNewComboBox.Create(OllamaPage);
  ModelComboBox.Parent := OllamaPage.Surface;
  ModelComboBox.Left := ScaleX(0);
  ModelComboBox.Top := ScaleY(80);
  ModelComboBox.Width := ScaleX(420);
  ModelComboBox.Style := csDropDownList;
  ModelComboBox.Items.Add('Meta Llama 3.1 8B (Recommended Default)');
  ModelComboBox.Items.Add('Meta Llama 3.2 3B (Fast & Lightweight)');
  ModelComboBox.Items.Add('Meta Llama 3.2 1B (Ultra-Low Memory)');
  ModelComboBox.Items.Add('Qwen 2.5 Coder 7B (Coding & Terminal Assistant)');
  ModelComboBox.Items.Add('Mistral Instruct 7B (High-Precision Reasoning)');
  ModelComboBox.Items.Add('Microsoft Phi-3.5 Mini 3.8B (Compact Reasoning)');
  ModelComboBox.Items.Add('DeepSeek R1 Distill 8B (Chain-of-Thought Reasoning)');
  ModelComboBox.Items.Add('Skip model download (Configure later)');
  ModelComboBox.ItemIndex := 0;
  ModelComboBox.OnChange := @OnModelChange;

  ModelDescLabel := TLabel.Create(OllamaPage);
  ModelDescLabel.Parent := OllamaPage.Surface;
  ModelDescLabel.Left := ScaleX(0);
  ModelDescLabel.Top := ScaleY(112);
  ModelDescLabel.Width := ScaleX(420);
  ModelDescLabel.Height := ScaleY(35);
  ModelDescLabel.WordWrap := True;
  ModelDescLabel.Caption := 'Recommended general assistant: balanced reasoning, instructions & speed (~4.7 GB, 8GB RAM).';

  StartOllamaCheckBox := TNewCheckBox.Create(OllamaPage);
  StartOllamaCheckBox.Parent := OllamaPage.Surface;
  StartOllamaCheckBox.Left := ScaleX(0);
  StartOllamaCheckBox.Top := ScaleY(155);
  StartOllamaCheckBox.Width := ScaleX(420);
  StartOllamaCheckBox.Caption := 'Start Ollama background service and verify local API on port 11434';
  StartOllamaCheckBox.Checked := True;
end;

function GetSelectedModelId(): string;
begin
  case ModelComboBox.ItemIndex of
    0: Result := 'llama3.1:8b';
    1: Result := 'llama3.2:3b';
    2: Result := 'llama3.2:1b';
    3: Result := 'qwen2.5-coder:7b';
    4: Result := 'mistral:7b';
    5: Result := 'phi3.5:3.8b';
    6: Result := 'deepseek-r1:8b';
    else Result := 'skip';
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ScriptPath: string;
  Params: string;
  ResultCode: Integer;
  ChosenModel: string;
begin
  if CurStep = ssPostInstall then
  begin
    ScriptPath := ExpandConstant('{app}\setup-ollama.ps1');
    if FileExists(ScriptPath) then
    begin
      ChosenModel := GetSelectedModelId();
      Params := '-ExecutionPolicy Bypass -NoProfile -File "' + ScriptPath + '" -ConfigPath "' + ExpandConstant('{app}\config.json') + '" -Model "' + ChosenModel + '" -EnsureNode';
      
      if InstallOllamaCheckBox.Checked then
        Params := Params + ' -InstallOllama';
        
      Params := Params + ' -Silent';

      WizardForm.StatusLabel.Caption := 'Configuring Mini-O runtime, Ollama AI engine, and companion model (' + ChosenModel + ')...';
      Exec('powershell.exe', Params, ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

