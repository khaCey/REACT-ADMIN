$env:NVM_HOME = ""
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$env:PM2_HOME = "C:\Users\khacey\.pm2"

$listeners = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 1

& "C:\Users\khacey\AppData\Roaming\npm\pm2.cmd" delete GreenSquareAdmin | Out-Null
& "C:\Users\khacey\AppData\Roaming\npm\pm2.cmd" delete GreenSquareADMIN | Out-Null
& "C:\Users\khacey\AppData\Roaming\npm\pm2.cmd" delete react-admin | Out-Null
& "C:\Users\khacey\AppData\Roaming\npm\pm2.cmd" start "C:\GitHub\REACT-ADMIN\ecosystem.config.cjs" --update-env
& "C:\Users\khacey\AppData\Roaming\npm\pm2.cmd" save --force
& "C:\Users\khacey\AppData\Roaming\npm\pm2.cmd" list
