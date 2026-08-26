<#
.SYNOPSIS
    Mini-O / Redrum AI - Automated Ollama Windows Installer & Model Configuration Manager
.DESCRIPTION
    Automates downloading, installing, starting Ollama on Windows, pulling recommended AI models,
    and configuring Mini-O's config.json with the chosen default local model.
.PARAMETER InstallOllama
    Automatically download and install Ollama if not present.
.PARAMETER Model
    Name of the Ollama model to pull and set as default (e.g. "llama3.1:8b", "llama3.2:3b", "qwen2.5-coder:7b", "mistral:7b", "phi3.5:3.8b", "deepseek-r1:8b", "none").
.PARAMETER ConfigPath
    Path to config.json to update with default model.
.PARAMETER Silent
    Run without interactive prompts (used by Inno Setup installer).
.PARAMETER ForceInstall
    Force re-download and re-installation of Ollama even if detected.
.EXAMPLE
    .\setup-ollama.ps1 -InstallOllama -Model "llama3.1:8b" -Silent
    .\setup-ollama.ps1
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$InstallOllama,

    [Parameter()]
    [switch]$EnsureNode,

    [Parameter()]
    [string]$Model = "",

    [Parameter()]
    [string]$ConfigPath = "",

    [Parameter()]
    [switch]$Silent,

    [Parameter()]
    [switch]$ForceInstall,

    [Parameter()]
    [string]$OllamaUrl = "http://127.0.0.1:11434"
)

$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = $ScriptDir
if (Test-Path (Join-Path $ScriptDir "..\dist\server.cjs")) {
    $BaseDir = Resolve-Path (Join-Path $ScriptDir "..")
}

if (-not $ConfigPath) {
    if (Test-Path (Join-Path $BaseDir "config.json")) {
        $ConfigPath = Join-Path $BaseDir "config.json"
    } elseif (Test-Path (Join-Path $ScriptDir "config.windows.json")) {
        $ConfigPath = Join-Path $ScriptDir "config.windows.json"
    }
}

$AvailableModels = @(
    @{ Id = "llama3.1:8b"; Name = "Meta Llama 3.1 (8B)"; Description = "Recommended default: balanced general intelligence, reasoning & speed"; Size = "~4.7 GB"; MinRam = "8 GB" },
    @{ Id = "llama3.2:3b"; Name = "Meta Llama 3.2 (3B)"; Description = "Fast & lightweight: optimal for laptops and ultra-responsive chat"; Size = "~2.0 GB"; MinRam = "6 GB" },
    @{ Id = "llama3.2:1b"; Name = "Meta Llama 3.2 (1B)"; Description = "Ultra-compact: minimal RAM footprint with rapid generation"; Size = "~1.3 GB"; MinRam = "4 GB" },
    @{ Id = "qwen2.5-coder:7b"; Name = "Qwen 2.5 Coder (7B)"; Description = "High-accuracy code generation, debugging, and terminal automation"; Size = "~4.7 GB"; MinRam = "8 GB" },
    @{ Id = "mistral:7b"; Name = "Mistral Instruct (7B)"; Description = "Sharp reasoning, instruction following, and structured markdown output"; Size = "~4.1 GB"; MinRam = "8 GB" },
    @{ Id = "phi3.5:3.8b"; Name = "Microsoft Phi-3.5 Mini (3.8B)"; Description = "Exceptional reasoning-to-size ratio from Microsoft Research"; Size = "~2.2 GB"; MinRam = "6 GB" },
    @{ Id = "deepseek-r1:8b"; Name = "DeepSeek R1 Distill (8B)"; Description = "Deep chain-of-thought step-by-step reasoning and logic analysis"; Size = "~4.9 GB"; MinRam = "8 GB" }
)

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Find-NodeExecutable {
    # 1. Check in PATH
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # 2. Check local application bin directory
    $localBin = Join-Path $BaseDir "bin\node.exe"
    if (Test-Path $localBin) { return $localBin }

    # 3. Check standard Windows installation directories
    $paths = @(
        "$env:LOCALAPPDATA\Mini-O\bin\node.exe",
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:APPDATA\npm\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )

    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }

    return $null
}

function Download-And-Install-Node {
    Write-Host "[Node Runtime] Downloading standalone Node.js runtime for Windows..." -ForegroundColor Yellow
    
    $targetBinDir = Join-Path $BaseDir "bin"
    if (-not (Test-Path $targetBinDir)) {
        New-Item -ItemType Directory -Path $targetBinDir -Force | Out-Null
    }
    $targetNodeExe = Join-Path $targetBinDir "node.exe"

    # Try downloading official standalone node.exe
    $nodeUrl = "https://nodejs.org/dist/v20.18.0/win-x64/node.exe"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        $webClient = New-Object System.Net.WebClient
        Write-Host "Downloading $nodeUrl -> $targetNodeExe..." -ForegroundColor DarkGray
        $webClient.DownloadFile($nodeUrl, $targetNodeExe)
        if (Test-Path $targetNodeExe) {
            Write-Host "[OK] Node.js standalone runtime downloaded to $targetNodeExe." -ForegroundColor Green
            return $targetNodeExe
        }
    } catch {
        Write-Host "[WARN] Direct node.exe download failed. Attempting winget fallback..." -ForegroundColor Yellow
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Host "Running: winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements" -ForegroundColor Cyan
            & winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
            Start-Sleep -Seconds 3
            return (Find-NodeExecutable)
        }
    }
    return $null
}

function Find-OllamaExecutable {
    # 1. Check in PATH
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # 2. Check standard Windows installation directories
    $paths = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe",
        "${env:ProgramFiles(x86)}\Ollama\ollama.exe",
        "$env:USERPROFILE\AppData\Local\Programs\Ollama\ollama.exe"
    )

    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }

    # 3. Check Registry
    try {
        $regPath = (Get-ItemProperty -Path "HKCU:\Software\Ollama" -Name "InstallLocation" -ErrorAction SilentlyContinue).InstallLocation
        if ($regPath -and (Test-Path (Join-Path $regPath "ollama.exe"))) {
            return (Join-Path $regPath "ollama.exe")
        }
    } catch {}

    return $null
}

function Test-OllamaApiRunning {
    try {
        $res = Invoke-RestMethod -Uri "$OllamaUrl/api/version" -TimeoutSec 2 -ErrorAction Stop
        if ($res.version) { return $true }
    } catch {}
    return $false
}

function Download-And-Install-Ollama {
    Write-Host "[Ollama Setup] Downloading Ollama for Windows..." -ForegroundColor Yellow
    $downloadUrl = "https://ollama.com/download/OllamaSetup.exe"
    $tempInstaller = Join-Path $env:TEMP "OllamaSetup.exe"

    if (Test-Path $tempInstaller) { Remove-Item $tempInstaller -Force -ErrorAction SilentlyContinue }

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        $webClient = New-Object System.Net.WebClient
        
        # Download with console status
        Write-Host "Downloading installer from $downloadUrl to $tempInstaller..." -ForegroundColor DarkGray
        $webClient.DownloadFile($downloadUrl, $tempInstaller)
        Write-Host "[OK] Download complete." -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Direct download failed. Attempting winget fallback..." -ForegroundColor Yellow
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Host "Running: winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements" -ForegroundColor Cyan
            & winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent
            Start-Sleep -Seconds 5
            return
        } else {
            Write-Host "[ERROR] Could not download Ollama: $_" -ForegroundColor Red
            return
        }
    }

    if (Test-Path $tempInstaller) {
        Write-Host "[Ollama Setup] Executing Ollama installer..." -ForegroundColor Cyan
        $proc = Start-Process -FilePath $tempInstaller -ArgumentList "/SILENT /NORESTART" -PassThru -Wait
        Start-Sleep -Seconds 3
        Write-Host "[OK] Ollama installation finished." -ForegroundColor Green
    }
}

function Ensure-OllamaRunning {
    param([string]$OllamaExe)

    if (Test-OllamaApiRunning) {
        Write-Host "[OK] Ollama API service is active at $OllamaUrl" -ForegroundColor Green
        return $true
    }

    Write-Host "[Ollama Setup] Starting Ollama background server..." -ForegroundColor Yellow
    if ($OllamaExe -and (Test-Path $OllamaExe)) {
        # Start Ollama serve or app
        $ollamaApp = Join-Path (Split-Path -Parent $OllamaExe) "ollama app.exe"
        if (Test-Path $ollamaApp) {
            Start-Process -FilePath $ollamaApp -WindowStyle Hidden
        } else {
            Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden
        }
    } else {
        # Try generic command
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
    }

    # Wait up to 25 seconds for the API to respond
    Write-Host "Waiting for Ollama service to respond on $OllamaUrl..." -ForegroundColor DarkGray
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 1
        if (Test-OllamaApiRunning) {
            Write-Host "[OK] Ollama server is online!" -ForegroundColor Green
            return $true
        }
    }

    Write-Host "[WARN] Ollama started, but API health check timed out. Proceeding..." -ForegroundColor Yellow
    return $false
}

function Get-InstalledModels {
    try {
        $res = Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 3 -ErrorAction Stop
        if ($res.models) {
            return $res.models | ForEach-Object { $_.name }
        }
    } catch {}
    return @()
}

function Pull-Model {
    param(
        [string]$ModelId,
        [string]$OllamaExe
    )

    if (-not $ModelId -or $ModelId -eq "none" -or $ModelId -eq "skip") {
        Write-Host "Skipping model download as requested." -ForegroundColor DarkGray
        return $true
    }

    Write-Host ""
    Write-Host "------------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host " Downloading AI Model: $ModelId" -ForegroundColor Cyan
    Write-Host " This may take a few minutes depending on your internet connection." -ForegroundColor DarkGray
    Write-Host "------------------------------------------------------------------" -ForegroundColor Cyan

    $installed = Get-InstalledModels
    if ($installed -contains $ModelId -or $installed -contains "$ModelId:latest") {
        Write-Host "[OK] Model '$ModelId' is already downloaded and cached locally." -ForegroundColor Green
        return $true
    }

    if ($OllamaExe -and (Test-Path $OllamaExe)) {
        Write-Host "Executing: ollama pull $ModelId" -ForegroundColor Cyan
        & $OllamaExe pull $ModelId
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Successfully downloaded $ModelId!" -ForegroundColor Green
            return $true
        }
    } else {
        # Fallback to direct REST pull if executable not in path
        Write-Host "Initiating model pull via Ollama REST API..." -ForegroundColor Cyan
        try {
            $body = @{ name = $ModelId; stream = $false } | ConvertTo-Json
            Invoke-RestMethod -Uri "$OllamaUrl/api/pull" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 1800
            Write-Host "[OK] Model pull completed via REST API." -ForegroundColor Green
            return $true
        } catch {
            Write-Host "[ERROR] Failed to pull model $ModelId: $_" -ForegroundColor Red
            return $false
        }
    }
    return $false
}

function Update-MiniOConfig {
    param(
        [string]$SelectedModel,
        [string]$TargetConfig
    )

    if (-not $TargetConfig -or -not (Test-Path $TargetConfig)) {
        Write-Host "[WARN] Config file not found at '$TargetConfig', skipping config update." -ForegroundColor Yellow
        return
    }

    try {
        $jsonContent = Get-Content -Path $TargetConfig -Raw | ConvertFrom-Json
        
        if ($SelectedModel -and $SelectedModel -ne "none" -and $SelectedModel -ne "skip") {
            if (-not $jsonContent.windows) {
                $jsonContent | Add-Member -MemberType NoteProperty -Name "windows" -Value (New-Object PSObject)
            }
            $jsonContent.windows.default_model = $SelectedModel
            $jsonContent.ollama.auto_pull_recommended = $true
        }
        
        $jsonContent.ollama.host = $OllamaUrl

        $jsonContent | ConvertTo-Json -Depth 10 | Set-Content -Path $TargetConfig -Encoding UTF8
        Write-Host "[OK] Updated Mini-O configuration at $TargetConfig with default model: $SelectedModel" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not update config file: $_" -ForegroundColor Yellow
    }
}

# ==============================================================================
# MAIN EXECUTION FLOW
# ==============================================================================

Write-Header "Mini-O Local AI & Runtime Configuration Wizard"

# 0. Ensure Node.js is available
$nodeExe = Find-NodeExecutable
if ($nodeExe) {
    Write-Host "[Found] Node.js runtime is available: $nodeExe" -ForegroundColor Green
} else {
    Write-Host "[Status] Node.js is not currently detected on this system." -ForegroundColor Yellow
    if ($EnsureNode -or $Silent) {
        $nodeExe = Download-And-Install-Node
    } elseif (-not $Silent) {
        Write-Host ""
        $nodeChoice = Read-Host "Would you like Mini-O to automatically download the Node.js runtime now? (Y/n)"
        if ($nodeChoice -ne 'n' -and $nodeChoice -ne 'N') {
            $nodeExe = Download-And-Install-Node
        }
    }
}

$ollamaExe = Find-OllamaExecutable

if ($ollamaExe) {
    Write-Host "[Found] Ollama is installed at: $ollamaExe" -ForegroundColor Green
} else {
    Write-Host "[Status] Ollama is not currently detected on this system." -ForegroundColor Yellow
}

# 1. Install Ollama if requested or missing
if (-not $ollamaExe -or $ForceInstall -or $InstallOllama) {
    if ($Silent -or $InstallOllama) {
        Download-And-Install-Ollama
    } elseif (-not $Silent) {
        Write-Host ""
        $choice = Read-Host "Would you like Mini-O to automatically download & install Ollama for Windows now? (Y/n)"
        if ($choice -ne 'n' -and $choice -ne 'N') {
            Download-And-Install-Ollama
        }
    }
    $ollamaExe = Find-OllamaExecutable
}

# 2. Ensure Ollama service is started
Ensure-OllamaRunning -OllamaExe $ollamaExe

# 3. Model Selection
$selectedModel = $Model

if (-not $selectedModel -and -not $Silent) {
    Write-Host ""
    Write-Host "Select an AI model to download and set as your default companion model:" -ForegroundColor Cyan
    Write-Host ""
    for ($i = 0; $i -lt $AvailableModels.Count; $i++) {
        $m = $AvailableModels[$i]
        Write-Host "  [$($i+1)] $($m.Name)" -ForegroundColor White
        Write-Host "      $($m.Description)" -ForegroundColor DarkGray
        Write-Host "      Download Size: $($m.Size) | Recommended RAM: $($m.MinRam)" -ForegroundColor DarkGray
    }
    Write-Host "  [0] Skip downloading a model for now (I will configure it later)" -ForegroundColor DarkGray
    Write-Host ""
    
    $selection = Read-Host "Enter choice (1-$($AvailableModels.Count), default is 1 for Llama 3.1 8B)"
    if ($selection -eq "" -or $selection -eq "1") {
        $selectedModel = $AvailableModels[0].Id
    } elseif ($selection -eq "0") {
        $selectedModel = "skip"
    } else {
        $idx = [int]$selection - 1
        if ($idx -ge 0 -and $idx -lt $AvailableModels.Count) {
            $selectedModel = $AvailableModels[$idx].Id
        } else {
            $selectedModel = $AvailableModels[0].Id
        }
    }
} elseif (-not $selectedModel) {
    # Default model for silent installs
    $selectedModel = "llama3.1:8b"
}

# 4. Pull chosen model
if ($selectedModel -and $selectedModel -ne "skip" -and $selectedModel -ne "none") {
    Pull-Model -ModelId $selectedModel -OllamaExe $ollamaExe
}

# 5. Update config.json
if ($ConfigPath) {
    Update-MiniOConfig -SelectedModel $selectedModel -TargetConfig $ConfigPath
}

Write-Header "Setup Complete! Mini-O AI is ready to use."
Write-Host "Default Model: $selectedModel" -ForegroundColor Cyan
Write-Host "Ollama Host  : $OllamaUrl" -ForegroundColor Cyan
if ($ConfigPath) {
    Write-Host "Config Path  : $ConfigPath" -ForegroundColor DarkGray
}
Write-Host ""
