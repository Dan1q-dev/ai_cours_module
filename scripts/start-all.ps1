$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-ListeningProcessId {
  param(
    [Parameter(Mandatory = $true)]
    [int] $Port
  )

  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    if ($connections) {
      return ($connections | Select-Object -First 1).OwningProcess
    }
  } catch {
    return $null
  }

  return $null
}

function Wait-ForHttpReady {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url,
    [Parameter(Mandatory = $true)]
    [string] $Name,
    [int] $TimeoutSeconds = 180
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "$Name is ready: $Url"
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  Write-Warning "$Name did not become ready in time: $Url"
  return $false
}

function Start-ServiceWindow {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Title,
    [Parameter(Mandatory = $true)]
    [string] $WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string] $Command,
    [Parameter(Mandatory = $true)]
    [int] $Port
  )

  $existingProcessId = Get-ListeningProcessId -Port $Port
  if ($existingProcessId) {
    Write-Host "$Title already listening on port $Port (PID $existingProcessId). Skipping duplicate start."
    return
  }

  $escapedTitle = $Title.Replace("'", "''")
  $escapedDir = $WorkingDirectory.Replace("'", "''")

  $bootstrap = @"
`$Host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location '$escapedDir'
$Command
"@

  Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $bootstrap
  ) | Out-Null
}

Start-ServiceWindow `
  -Title 'AI Demo - Web (Next.js)' `
  -WorkingDirectory $projectRoot `
  -Command 'npm run dev' `
  -Port 3000

Start-ServiceWindow `
  -Title 'AI Demo - Local STT' `
  -WorkingDirectory (Join-Path $projectRoot 'local-stt') `
  -Command '.\run.ps1' `
  -Port 8001

Start-ServiceWindow `
  -Title 'AI Demo - Local TTS' `
  -WorkingDirectory (Join-Path $projectRoot 'local-tts') `
  -Command '.\run.ps1' `
  -Port 8002

Start-ServiceWindow `
  -Title 'AI Demo - Local Avatar' `
  -WorkingDirectory (Join-Path $projectRoot 'local-avatar') `
  -Command '.\run.ps1' `
  -Port 8003

Write-Host 'Started 4 windows: Web, STT, TTS, Avatar.'
Write-Host 'Waiting for service readiness...'

$null = Wait-ForHttpReady -Name 'Local STT' -Url 'http://127.0.0.1:8001/health'
$null = Wait-ForHttpReady -Name 'Local TTS' -Url 'http://127.0.0.1:8002/health'
$null = Wait-ForHttpReady -Name 'Local Avatar' -Url 'http://127.0.0.1:8003/health'
$null = Wait-ForHttpReady -Name 'Next.js Gateway' -Url 'http://127.0.0.1:3000/api/health'

Write-Host 'Gateway URL: http://127.0.0.1:3000'
