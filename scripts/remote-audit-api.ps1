$ports = @(3001, 3002, 5173)
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in $ports } |
  Select-Object LocalAddress, LocalPort, OwningProcess -Unique

if (-not $listeners) {
  Write-Output 'NO_TARGET_PORT_LISTENERS'
} else {
  foreach ($l in $listeners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Output ("PORT={0} PID={1} NAME={2}" -f $l.LocalPort, $l.OwningProcess, $proc.Name)
    if ($proc.CommandLine) {
      Write-Output ("CMD={0}" -f $proc.CommandLine)
    }
  }
}

$apiNodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server[\\/]+index\.js' }

Write-Output ("API_NODE_COUNT={0}" -f $apiNodes.Count)
foreach ($p in $apiNodes) {
  Write-Output ("API_PID={0}" -f $p.ProcessId)
  Write-Output ("API_CMD={0}" -f $p.CommandLine)
}
