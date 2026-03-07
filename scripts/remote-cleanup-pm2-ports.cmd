@echo off
setlocal

set "PM2_HOME=C:\Users\khacey\.pm2"
set "PM2_BIN=C:\Users\khacey\AppData\Roaming\npm\pm2.cmd"

echo === PM2 CLEANUP ===
if exist "%PM2_BIN%" (
  call "%PM2_BIN%" delete all
  if errorlevel 1 echo PM2_DELETE_ALL_FAILED_OR_EMPTY
) else (
  echo PM2_BIN_NOT_FOUND
)

echo === PORT CLEANUP ===
for %%P in (3001 3002 5173) do (
  echo PORT_CHECK %%P
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo TRY_KILL PORT=%%P PID=%%I
    taskkill /PID %%I /F
    if errorlevel 1 echo KILL_FAILED PORT=%%P PID=%%I
  )
)

echo === FINAL LISTENERS ===
netstat -ano | findstr /R /C:":3001 " /C:":3002 " /C:":5173 "
if errorlevel 1 echo NO_TARGET_PORT_LISTENERS

exit /b 0

