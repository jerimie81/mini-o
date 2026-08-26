@echo off
REM ==============================================================================
REM Mini-O / Redrum AI - Windows Command Prompt CLI & Launcher Utility
REM ==============================================================================
setlocal EnableDelayedExpansion

set "APP_DIR=%~dp0"
REM Remove trailing backslash if present
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"

set "PORT=%PORT%"
if "%PORT%"=="" set "PORT=3000"

set "HOST=%HOST%"
if "%HOST%"=="" set "HOST=127.0.0.1"

set "URL=http://%HOST%:%PORT%"
set "LOG_DIR=%LOCALAPPDATA%\Mini-O\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul
set "LOG_FILE=%LOG_DIR%\mini-o.log"
set "PID_FILE=%LOCALAPPDATA%\Mini-O\mini-o.pid"

set "CMD=%~1"
if "%CMD%"=="" set "CMD=help"

if /i "%CMD%"=="help" goto :help
if /i "%CMD%"=="--help" goto :help
if /i "%CMD%"=="-h" goto :help
if /i "%CMD%"=="start" goto :start_server
if /i "%CMD%"=="stop" goto :stop_server
if /i "%CMD%"=="status" goto :server_status
if /i "%CMD%"=="run" goto :run_foreground
if /i "%CMD%"=="open" goto :open_browser
if /i "%CMD%"=="logs" goto :view_logs
if /i "%CMD%"=="config" goto :show_config
if /i "%CMD%"=="version" goto :show_version
if /i "%CMD%"=="setup-ollama" goto :setup_ollama
if /i "%CMD%"=="models" goto :setup_ollama
if /i "%CMD%"=="install-service" goto :install_service

echo Unknown command: %CMD%
echo.
goto :help

:help
echo Mini-O - Local-first AI Companion & Workspace (Windows Edition)
echo.
echo Usage: mini-o.cmd ^<command^> [options]
echo.
echo Commands:
echo   open             Start Mini-O if needed and open in default web browser
echo   start            Start Mini-O server in background window
echo   stop             Stop any running Mini-O server processes
echo   status           Check server health and connectivity
echo   run              Run Mini-O server in active console (foreground)
echo   logs             Display recent server log entries
echo   config           Show active paths and configuration details
echo   setup-ollama     Download & configure Ollama and choose default AI model
echo   models           Interactive local model selector & downloader
echo   install-service  Register Mini-O as a Windows Service (Admin required)
echo   version          Show version information
echo   help             Display this help message
echo.
echo Environment Variables:
echo   PORT             Port number (default: 3000)
echo   HOST             Host interface (default: 127.0.0.1)
echo   GEMINI_API_KEY   Optional Gemini API key for remote acceleration
echo.
goto :eof

:check_node
set "NODE_EXE="
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "NODE_EXE=node"
    exit /b 0
)

if exist "%APP_DIR%\bin\node.exe" (
    set "NODE_EXE=%APP_DIR%\bin\node.exe"
    exit /b 0
)
if exist "%LOCALAPPDATA%\Mini-O\bin\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Mini-O\bin\node.exe"
    exit /b 0
)
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    exit /b 0
)

echo [Setup] Node.js runtime not found. Automatically provisioning lightweight standalone runtime...
if not exist "%APP_DIR%\bin" mkdir "%APP_DIR%\bin" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; (New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.18.0/win-x64/node.exe', '%APP_DIR%\bin\node.exe')"
if exist "%APP_DIR%\bin\node.exe" (
    set "NODE_EXE=%APP_DIR%\bin\node.exe"
    echo [OK] Standalone Node.js runtime provisioned successfully.
    exit /b 0
)

echo [WARN] Automatic download failed. Attempting winget install...
winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
set "NODE_EXE=node"
exit /b 0

:is_running
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri '%URL%/api/health' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    exit /b 0
)
exit /b 1

:start_server
call :check_node || exit /b 1
call :is_running
if %ERRORLEVEL% equ 0 (
    echo Mini-O is already running on %URL%
    exit /b 0
)

echo Starting Mini-O server on %URL% in background...
set "SERVER_SCRIPT=%APP_DIR%\dist\server.cjs"
if not exist "%SERVER_SCRIPT%" set "SERVER_SCRIPT=%APP_DIR%\server.cjs"

start "Mini-O Server" /min "%ComSpec%" /c "cd /d "%APP_DIR%" && set NODE_ENV=production&& set PORT=%PORT%&& set HOST=%HOST%&& "%NODE_EXE%" "%SERVER_SCRIPT%" >> "%LOG_FILE%" 2>&1"

REM Wait up to 6 seconds for health check
echo Waiting for server to initialize...
set /a count=0
:wait_loop
timeout /t 1 /nobreak >nul
call :is_running
if %ERRORLEVEL% equ 0 (
    echo Mini-O server is up and listening on %URL%
    echo Logs: %LOG_FILE%
    exit /b 0
)
set /a count+=1
if %count% lss 6 goto :wait_loop

echo Server started in background. If you cannot connect, check logs at:
echo %LOG_FILE%
exit /b 0

:open_browser
call :is_running
if %ERRORLEVEL% neq 0 (
    call :start_server
    timeout /t 1 /nobreak >nul
)
echo Opening %URL% in your default web browser...
start "" "%URL%"
exit /b 0

:run_foreground
call :check_node || exit /b 1
echo Running Mini-O in foreground on %URL%...
echo Press Ctrl+C to stop the server.
cd /d "%APP_DIR%"
set NODE_ENV=production
set PORT=%PORT%
set HOST=%HOST%
set "SERVER_SCRIPT=%APP_DIR%\dist\server.cjs"
if not exist "%SERVER_SCRIPT%" set "SERVER_SCRIPT=%APP_DIR%\server.cjs"
"%NODE_EXE%" "%SERVER_SCRIPT%"
exit /b 0

:stop_server
echo Stopping Mini-O server processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.cjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo Mini-O server stopped.
exit /b 0

:server_status
echo --- Mini-O Status Check (Windows) ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $res = Invoke-RestMethod -Uri '%URL%/api/health' -TimeoutSec 2 -ErrorAction Stop; Write-Host 'Status: ONLINE' -ForegroundColor Green; Write-Host ('URL:    ' + '%URL%'); Write-Host ('Health: ' + ($res | ConvertTo-Json -Compress)) } catch { Write-Host 'Status: OFFLINE' -ForegroundColor Red; Write-Host ('Target: ' + '%URL%') }"
exit /b 0

:view_logs
if exist "%LOG_FILE%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path '%LOG_FILE%' -Tail 40"
) else (
    echo No log file found at %LOG_FILE%
)
exit /b 0

:show_config
echo Configuration Details:
echo   Application Directory : %APP_DIR%
echo   Server Script         : %APP_DIR%\dist\server.cjs
echo   Logs File             : %LOG_FILE%
echo   Local Data Root       : %APP_DIR%\data
echo   Target URL            : %URL%
exit /b 0

:show_version
echo Mini-O v0.1.0 (Windows Native Edition)
echo Architecture: x64 / amd64
echo Platform: Windows NT (Node.js runtime)
exit /b 0

:setup_ollama
set "MODEL_ARG=%~2"
if not "%MODEL_ARG%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\setup-ollama.ps1" -Model "%MODEL_ARG%" -ConfigPath "%APP_DIR%\config.json"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\setup-ollama.ps1" -ConfigPath "%APP_DIR%\config.json"
)
exit /b 0

:install_service
echo Launching Windows Service installer script...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\install-service.ps1"
exit /b 0
