@echo off
setlocal

set "NVM_HOME="
set "PATH=C:\Program Files\nodejs;%PATH%"
set "PM2_HOME=C:\Users\khacey\.pm2"
set "PM2_BIN=C:\Users\khacey\AppData\Roaming\npm\pm2.cmd"

cd /d C:\GitHub\REACT-ADMIN\client || exit /b 1
call npm install || exit /b 1

call "%PM2_BIN%" delete react-client >nul 2>&1
set API_PORT=3002
call "%PM2_BIN%" start npm --name react-client -- run dev -- --host 0.0.0.0 --port 5173 || exit /b 1
call "%PM2_BIN%" save --force || exit /b 1
call "%PM2_BIN%" list || exit /b 1

exit /b 0

