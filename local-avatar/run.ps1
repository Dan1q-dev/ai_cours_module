$ErrorActionPreference = 'Stop'

if (Test-Path ..\.env.local) {
  Get-Content ..\.env.local | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    $parts = $_ -split '=', 2
    if ($parts.Count -eq 2) {
      $key = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"')
      if ($key -and -not [string]::IsNullOrWhiteSpace($value)) {
        Set-Item -Path "Env:$key" -Value $value
      }
    }
  }
}

if (-not (Test-Path .venv)) {
  python -m venv .venv
}

$pythonExe = Join-Path $PWD '.venv\Scripts\python.exe'
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r requirements.txt --prefer-binary --timeout 120

if (-not $env:AVATAR_ENGINE) { $env:AVATAR_ENGINE = 'musetalk' }
if (-not $env:MUSE_TALK_PYTHON) { $env:MUSE_TALK_PYTHON = 'python' }
if (-not $env:MUSE_TALK_VERSION) { $env:MUSE_TALK_VERSION = 'v15' }
if (-not $env:AVATAR_RESULTS_DIR) { $env:AVATAR_RESULTS_DIR = '.\runs' }
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$sourceAsset = $env:AVATAR_SOURCE_ASSET
if (-not $sourceAsset) { $sourceAsset = $env:AVATAR_SOURCE_VIDEO }

switch ($env:AVATAR_ENGINE.ToLowerInvariant()) {
  'musetalk' {
    if (-not $env:MUSE_TALK_ROOT) {
      Write-Warning 'MUSE_TALK_ROOT is not set. MuseTalk mode may fail to locate the renderer.'
    } elseif (-not (Test-Path $env:MUSE_TALK_ROOT)) {
      Write-Warning "MUSE_TALK_ROOT does not exist: $env:MUSE_TALK_ROOT"
    }
  }
  default {
    Write-Warning "Unsupported AVATAR_ENGINE: $($env:AVATAR_ENGINE). Supported values: musetalk."
  }
}

if ($sourceAsset -and -not (Test-Path $sourceAsset)) {
  Write-Warning "Avatar source asset not found: $sourceAsset"
}

& $pythonExe -m uvicorn app:app --host 127.0.0.1 --port 8003
