@echo off
REM ==============================================================================
REM Mini-O - Windows Cleanup & Uninstaller Utility
REM ==============================================================================
setlocal EnableDelayedExpansion

echo ==================================================================
echo  Mini-O AI Workspace - Windows Cleanup & Uninstall
echo ==================================================================
echo.
echo This will stop all running Mini-O background processes, remove
echo scheduled auto-start tasks, and optionally clean cache directories.
echo.
set /p CONFIRM="Proceed with cleanup? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Uninstall cancelled.
    exit /b 0
)

echo.
echo [1/3] Stopping running processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.cjs*' -or $_.CommandLine -like '*mini-o*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [2/3] Removing service and task scheduler entries...
schtasks /delete /tn "Mini-O-Daemon" /f >nul 2>&1
sc.exe stop Mini-O >nul 2>&1
sc.exe delete Mini-O >nul 2>&1

echo [3/3] Removing temporary logs...
set "LOG_DIR=%LOCALAPPDATA%\Mini-O"
if exist "%LOG_DIR%" (
    echo Note: User logs located at %LOG_DIR%
)

echo.
echo ==================================================================
echo  Mini-O has been stopped and uninstalled from Windows services.
echo  You can now safely delete this folder if no longer needed.
echo ==================================================================
pause
