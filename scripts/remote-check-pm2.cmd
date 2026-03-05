@echo off
REM Run this ON THE REMOTE SERVER (GreenSquarePC) after SSH.
setlocal
set "PATH=%PATH%;%APPDATA%\npm"
set "PM2=%APPDATA%\npm\pm2.cmd"

echo === PM2 process list ===
call "%PM2%" list 2>nul || (echo PM2 not found at %PM2% && exit /b 1)

echo.
echo === Ports 3002 and 5173 ===
netstat -ano | findstr ":3002 :5173"

exit /b 0
