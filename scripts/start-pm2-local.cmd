@echo off
REM Start PM2 locally. Kills processes on 3002 first to avoid EADDRINUSE crash loop.
setlocal

cd /d C:\GitHub\REACT-ADMIN || exit /b 1

REM Kill whatever is on port 3002 (run as Admin if needed)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3002 .*LISTENING" 2^>nul') do (
  echo Killing PID %%P on port 3002
  taskkill /PID %%P /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

call pm2 delete GreenSquareAdmin >nul 2>&1
call pm2 delete GreenSquareADMIN >nul 2>&1
call pm2 start ecosystem.config.cjs --update-env
call pm2 save
call pm2 list

exit /b 0
