@echo off
REM Start only react-client (Vite on 5173). API (3002) stays running.
setlocal
set "PATH=%PATH%;C:\Program Files\nodejs"
set "PM2_HOME=C:\Users\khacey\.pm2"
set "PM2_BIN=%APPDATA%\npm\pm2.cmd"

cd /d C:\GitHub\REACT-ADMIN || exit /b 1

call "%PM2_BIN%" delete react-client >nul 2>&1
call "%PM2_BIN%" start ecosystem.config.cjs --only react-client --update-env
call "%PM2_BIN%" save --force
call "%PM2_BIN%" list

exit /b 0
