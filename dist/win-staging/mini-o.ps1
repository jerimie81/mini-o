<#
.SYNOPSIS
    Mini-O / Redrum AI - PowerShell Management & Launcher Utility
.DESCRIPTION
    Launches, manages, checks status, stops, and configures the Mini-O AI Workspace on Windows.
.EXAMPLE
    .\mini-o.ps1 open
    .\mini-o.ps1 start
    .\mini-o.ps1 status
    .\mini-o.ps1 stop
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status', 'open', 'run', 'logs', 'config', 'version', 'setup-ollama', 'models', 'install-service', 'uninstall-service', 'help')]
    [string]$Command = 'help',

    [Parameter()]
    [string]$Model = "",

    [Parameter()]
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 3000 }),

    [Parameter()]
    [string]$HostAddress = $(if ($env:HOST) { $env:HOST } else { '127.0.0.1' }),

    [Parameter()]
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = $ScriptDir
if (Test-Path (Join-Path $ScriptDir "..\dist\server.cjs")) {
    $BaseDir = Resolve-Path (Join-Path $ScriptDir "..")
}

$ServerScript = Join-Path $BaseDir "dist\server.cjs"
if (-not (Test-Path $ServerScript)) {
    $ServerScript = Join-Path $BaseDir "server.cjs"
}

$Url = "http://${HostAddress}:${Port}"
$LogDir = Join-Path $env:LOCALAPPDATA "Mini-O\logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir "mini-o.log"

$script:NodeExe = "node.exe"

function Ensure-NodeInstalled {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $script:NodeExe = $node.Source
        return $true
    }

    $localBin = Join-Path $BaseDir "bin\node.exe"
    if (Test-Path $localBin) {
        $script:NodeExe = $localBin
        return $true
    }

    $paths = @(
        "$env:LOCALAPPDATA\Mini-O\bin\node.exe",
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) {
            $script:NodeExe = $p
            return $true
        }
    }

    Write-Host "[Setup] Node.js not detected. Automatically downloading standalone Node.js runtime..." -ForegroundColor Yellow
    $targetBin = Join-Path $BaseDir "bin"
    if (-not (Test-Path $targetBin)) { New-Item -ItemType Directory -Path $targetBin -Force | Out-Null }
    $targetExe = Join-Path $targetBin "node.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile("https://nodejs.org/dist/v20.18.0/win-x64/node.exe", $targetExe)
        if (Test-Path $targetExe) {
            $script:NodeExe = $targetExe
            Write-Host "[OK] Node.js runtime provisioned successfully." -ForegroundColor Green
            return $true
        }
    } catch {}

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        & winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
        $script:NodeExe = "node.exe"
        return $true
    }

    Write-Host "[ERROR] Could not automatically download Node.js." -ForegroundColor Red
    return $false
}

function Test-ServerRunning {
    try {
        $res = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        return ($res.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Start-MiniOServer {
    if (-not (Ensure-NodeInstalled)) { return }
    if (Test-ServerRunning) {
        Write-Host "Mini-O is already running at $Url" -ForegroundColor Green
        return
    }

    Write-Host "Starting Mini-O server in background on $Url..." -ForegroundColor Cyan
    
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:NodeExe
    $startInfo.Arguments = "`"$ServerScript`""
    $startInfo.WorkingDirectory = $BaseDir
    $startInfo.EnvironmentVariables["NODE_ENV"] = "production"
    $startInfo.EnvironmentVariables["PORT"] = "$Port"
    $startInfo.EnvironmentVariables["HOST"] = "$HostAddress"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $process.Start() | Out-Null

    # Redirect logs asynchronously
    Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action {
        if ($EventArgs.Data) { Add-Content -Path $using:LogFile -Value $EventArgs.Data }
    } | Out-Null
    Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action {
        if ($EventArgs.Data) { Add-Content -Path $using:LogFile -Value $EventArgs.Data }
    } | Out-Null
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()

    Write-Host "Waiting for server startup..." -ForegroundColor DarkGray
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-ServerRunning) {
            Write-Host "Mini-O is up and ready at $Url (PID: $($process.Id))" -ForegroundColor Green
            Write-Host "Logs: $LogFile" -ForegroundColor DarkGray
            return
        }
    }
    Write-Host "Server process started. If UI doesn't load, inspect logs at: $LogFile" -ForegroundColor Yellow
}

function Stop-MiniOServer {
    Write-Host "Terminating Mini-O processes..." -ForegroundColor Yellow
    $killed = 0
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.cjs*' -or $_.CommandLine -like '*mini-o*' } | ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            $killed++
        } catch {}
    }
    Write-Host "Stopped $killed Mini-O process(es)." -ForegroundColor Green
}

function Show-Status {
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host " Mini-O Server Status (Windows)" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    if (Test-ServerRunning) {
        Write-Host "Status : ONLINE" -ForegroundColor Green
        Write-Host "URL    : $Url"
        try {
            $diag = Invoke-RestMethod -Uri "$Url/api/diagnostics" -TimeoutSec 2
            Write-Host "Version: $($diag.version)"
            Write-Host "Uptime : $([Math]::Round($diag.uptime, 1)) seconds"
            Write-Host "Root   : $($diag.workspace_dir)"
        } catch {}
    } else {
        Write-Host "Status : OFFLINE" -ForegroundColor Red
        Write-Host "Target : $Url"
    }
    Write-Host "LogFile: $LogFile"
    Write-Host "==========================================" -ForegroundColor Cyan
}

function Open-MiniO {
    if (-not (Test-ServerRunning)) {
        Start-MiniOServer
        Start-Sleep -Seconds 1
    }
    if (-not $NoBrowser) {
        Write-Host "Opening $Url in default web browser..." -ForegroundColor Cyan
        Start-Process $Url
    }
}

function Run-Foreground {
    if (-not (Ensure-NodeInstalled)) { return }
    Write-Host "Running Mini-O in active console on $Url (Press Ctrl+C to stop)..." -ForegroundColor Cyan
    $env:NODE_ENV = "production"
    $env:PORT = "$Port"
    $env:HOST = "$HostAddress"
    Set-Location $BaseDir
    & $script:NodeExe $ServerScript
}

switch ($Command) {
    'open'              { Open-MiniO }
    'start'             { Start-MiniOServer }
    'stop'              { Stop-MiniOServer }
    'status'            { Show-Status }
    'run'               { Run-Foreground }
    'logs'              { if (Test-Path $LogFile) { Get-Content $LogFile -Tail 50 -Wait } else { Write-Host "No log file found." } }
    'config'            { Write-Host "App Dir: $BaseDir`nLogs: $LogFile`nTarget URL: $Url" }
    'version'           { Write-Host "Mini-O v0.1.0 (Windows Edition)" }
    'setup-ollama'      { & (Join-Path $ScriptDir "setup-ollama.ps1") -Model $Model }
    'models'            { & (Join-Path $ScriptDir "setup-ollama.ps1") -Model $Model }
    'install-service'   { & (Join-Path $ScriptDir "install-service.ps1") }
    'uninstall-service' { & (Join-Path $ScriptDir "install-service.ps1") -Uninstall }
    default {
        Write-Host "Mini-O - Local-first AI Companion & Workspace (PowerShell Manager)`n" -ForegroundColor Cyan
        Write-Host "Usage: .\mini-o.ps1 <command> [-Model <name>] [-Port 3000] [-HostAddress 127.0.0.1]"
        Write-Host "Commands:"
        Write-Host "  open              Start server if needed and open in browser" -ForegroundColor White
        Write-Host "  start             Start server as background process" -ForegroundColor White
        Write-Host "  stop              Stop running Mini-O processes" -ForegroundColor White
        Write-Host "  status            Check server health and readiness" -ForegroundColor White
        Write-Host "  run               Run server in active foreground console" -ForegroundColor White
        Write-Host "  logs              Follow server log stream" -ForegroundColor White
        Write-Host "  setup-ollama      Download Ollama, choose AI model & configure defaults" -ForegroundColor White
        Write-Host "  models            Interactive local model selector & downloader" -ForegroundColor White
        Write-Host "  install-service   Register as Windows Service" -ForegroundColor White
        Write-Host "  version           Show version information" -ForegroundColor White
    }
}
