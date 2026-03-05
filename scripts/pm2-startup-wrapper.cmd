@echo off
REM Wrapper for PM2 startup. Delays so Docker/PostgreSQL are ready.
setlocal

cd /d "%~dp0.." || exit /b 1

REM Ensure npm/pm2 in PATH (Task Scheduler can have minimal env)
set "PATH=%APPDATA%\npm;%ProgramFiles%\nodejs;%PATH%"

REM Wait for system to finish booting (Docker, PostgreSQL, etc.)
timeout /t 15 /nobreak >nul

call "%~dp0start-pm2-local.cmd"
exit /b %ERRORLEVEL%
