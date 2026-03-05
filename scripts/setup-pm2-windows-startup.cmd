@echo off
REM Register PM2 to auto-start when you log on (Windows).
REM Run this once. Requires admin to create the task.
setlocal

set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%" || exit /b 1

set "WRAPPER=%PROJECT_ROOT%\scripts\pm2-startup-wrapper.cmd"
set "TASK_NAME=GreenSquareAdmin-PM2"

echo Creating scheduled task: %TASK_NAME%
echo Runs at logon: %WRAPPER%
echo.

schtasks /create /tn "%TASK_NAME%" /tr "\"%WRAPPER%\"" /sc onlogon /ru "%USERNAME%" /f
if %ERRORLEVEL% neq 0 (
  echo Failed. Try: Right-click - Run as administrator
  exit /b 1
)

echo.
echo Done. PM2 will start when you log on.
echo To remove: schtasks /delete /tn "%TASK_NAME%" /f
echo.
pause
