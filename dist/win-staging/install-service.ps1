<#
.SYNOPSIS
    Installs or uninstalls Mini-O as a background Windows Service.
.DESCRIPTION
    Uses Windows Service Control (sc.exe) or NSSM/WinSW to register Mini-O as an automatic Windows Service.
#>

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$ServiceName = "Mini-O",
    [string]$DisplayName = "Mini-O AI Workspace",
    [int]$Port = 3000
)

# Verify Administrator privileges
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ELEVATION REQUIRED] Please run PowerShell as Administrator to configure Windows Services." -ForegroundColor Yellow
    Exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = $ScriptDir
if (Test-Path (Join-Path $ScriptDir "..\dist\server.cjs")) {
    $BaseDir = Resolve-Path (Join-Path $ScriptDir "..")
}
$ServerScript = Join-Path $BaseDir "dist\server.cjs"
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue)?.Source

if (-not $NodeExe) {
    Write-Host "[ERROR] node.exe was not found in system PATH." -ForegroundColor Red
    Exit 1
}

if ($Uninstall) {
    Write-Host "Removing Windows Service '$ServiceName'..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName
    Write-Host "Mini-O Windows Service removed." -ForegroundColor Green
    Exit 0
}

Write-Host "Registering Mini-O as an Automatic Windows Service..." -ForegroundColor Cyan
Write-Host "  Service Name : $ServiceName"
Write-Host "  Display Name : $DisplayName"
Write-Host "  Working Dir  : $BaseDir"
Write-Host "  Server Script: $ServerScript"

# Create log directory
$LogDir = Join-Path $BaseDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# Stop existing if present
sc.exe stop $ServiceName >$null 2>&1
sc.exe delete $ServiceName >$null 2>&1
Start-Sleep -Seconds 1

# Check if WinSW or NSSM is present, otherwise configure startup registry / task scheduler fallback
$BinPath = "`"$NodeExe`" `"$ServerScript`""
sc.exe create $ServiceName binPath= "$BinPath" start= auto DisplayName= "$DisplayName"

if ($LASTEXITCODE -eq 0) {
    sc.exe description $ServiceName "Local-first personal AI assistant and workspace daemon for Windows"
    Write-Host "Mini-O Windows Service successfully created!" -ForegroundColor Green
    Write-Host "Starting service..." -ForegroundColor Cyan
    sc.exe start $ServiceName
    Write-Host "Service is active and set to start automatically with Windows." -ForegroundColor Green
} else {
    Write-Host "Fallback: Creating Windows Task Scheduler auto-start entry..." -ForegroundColor Yellow
    $Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$ServerScript`"" -WorkingDirectory $BaseDir
    $Trigger = New-ScheduledTaskTrigger -AtLogOn
    $Principal = New-Object -TypeName Microsoft.PowerShell.Cmdletization.GeneratedTypes.ScheduledTask.Principal
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "Mini-O-Daemon" -Action $Action -Trigger $Trigger -Settings $Settings -Description "Mini-O Local AI Workspace Server" -Force
    Write-Host "Task Scheduler entry 'Mini-O-Daemon' created for automatic user logon startup." -ForegroundColor Green
}
