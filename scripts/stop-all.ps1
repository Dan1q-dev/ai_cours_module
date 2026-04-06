$ErrorActionPreference = 'Stop'

$ports = @(3000, 8001, 8002, 8003)
$stopped = @()

foreach ($port in $ports) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
  } catch {
    continue
  }

  foreach ($connection in $connections | Select-Object -Unique OwningProcess) {
    $processId = $connection.OwningProcess
    if (-not $processId) {
      continue
    }
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      $stopped += [PSCustomObject]@{
        Port = $port
        PID = $processId
      }
      Write-Host "Stopped process PID $processId on port $port"
    } catch {
      Write-Warning "Failed to stop PID $processId on port ${port}: $($_.Exception.Message)"
    }
  }
}

if ($stopped.Count -eq 0) {
  Write-Host 'No AI demo services were listening on ports 3000, 8001, 8002, 8003.'
}
