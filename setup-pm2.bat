@echo off
REM Setup PM2 to run npm start and auto-start on system boot
cd /d "%~dp0"

echo Installing PM2 globally (if not already installed)...
call npm install -g pm2

echo.
echo Stopping existing process (if any)...
call pm2 delete react-admin 2>nul

echo.
echo Starting app with PM2...
call pm2 start npm --name "react-admin" -- start

echo.
echo Saving PM2 process list...
call pm2 save

echo.
echo ============================================
echo PM2 startup configured.
echo To auto-start on boot, run this as Administrator:
echo.
call pm2 startup
echo.
echo ============================================
echo Done. App is running. Use: pm2 status, pm2 logs, pm2 restart react-admin
pause
