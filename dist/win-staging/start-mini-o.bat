@echo off
REM ==============================================================================
REM Mini-O - Quick Double-Click Launcher for Windows
REM Zero-Setup: Automatically provisions runtime and launches the local AI workspace
REM ==============================================================================
title Mini-O AI Workspace
cd /d "%~dp0"

REM 1. Verify Node.js runtime (System PATH or Local Bin)
set "NODE_CMD="
where node >nul 2>&1
if %ERRORLEVEL% equ 0 set "NODE_CMD=node"

if "%NODE_CMD%"=="" (
    if exist "%~dp0bin\node.exe" set "NODE_CMD=%~dp0bin\node.exe"
)
if "%NODE_CMD%"=="" (
    if exist "%LOCALAPPDATA%\Mini-O\bin\node.exe" set "NODE_CMD=%LOCALAPPDATA%\Mini-O\bin\node.exe"
)
if "%NODE_CMD%"=="" (
    if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
)

REM 2. If Node is completely absent, automatically download standalone runtime (0 user setup)
if "%NODE_CMD%"=="" (
    echo ==================================================================
    echo  Mini-O First-Time Setup: Downloading lightweight Node.js runtime...
    echo ==================================================================
    if not exist "%~dp0bin" mkdir "%~dp0bin"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/win-x64/node.exe', '%~dp0bin\node.exe')"
    if exist "%~dp0bin\node.exe" (
        set "NODE_CMD=%~dp0bin\node.exe"
        echo [OK] Node.js runtime ready.
    ) else (
        echo [WARN] Automatic download failed. Attempting winget install...
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
        set "NODE_CMD=node"
    )
)

REM 3. Ensure local Ollama daemon is running if installed
where ollama >nul 2>&1
if %ERRORLEVEL% equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        start "Ollama Service" /min ollama serve
    )
)

REM 4. Launch Mini-O workspace in default web browser
call "%~dp0mini-o.cmd" open

