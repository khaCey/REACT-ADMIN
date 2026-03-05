@echo off
schtasks /delete /tn "GreenSquareAdmin-PM2" /f 2>nul
if %ERRORLEVEL% equ 0 (
  echo Removed PM2 startup task.
) else (
  echo Task not found or already removed.
)
pause
