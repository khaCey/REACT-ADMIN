@echo off
setlocal

set "NVM_HOME="
set "PATH=C:\Program Files\nodejs;%PATH%"
set "PM2_HOME=C:\Users\khacey\.pm2"
set "PM2_BIN=C:\Users\khacey\AppData\Roaming\npm\pm2.cmd"

cd /d C:\GitHub\REACT-ADMIN || exit /b 1
call npm run setup || exit /b 1
call npm run build || exit /b 1
call npm install -g pm2 || exit /b 1

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3002 .*LISTENING"') do (
  taskkill /PID %%P /F >nul 2>&1
)

call "%PM2_BIN%" delete GreenSquareAdmin >nul 2>&1
call "%PM2_BIN%" delete react-admin >nul 2>&1
call "%PM2_BIN%" start ecosystem.config.cjs --update-env || exit /b 1
call "%PM2_BIN%" save --force || exit /b 1
call "%PM2_BIN%" list || exit /b 1

exit /b 0

