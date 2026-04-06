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

if (-not $env:PIPER_EXE) { $env:PIPER_EXE = 'C:\piper\piper.exe' }
if (-not $env:PIPER_MODEL_RU) { $env:PIPER_MODEL_RU = 'C:\piper\models\ru\denis\ru_RU-denis-medium.onnx' }

if (-not (Test-Path $env:PIPER_EXE)) { throw "PIPER_EXE not found: $env:PIPER_EXE" }
if (-not (Test-Path $env:PIPER_MODEL_RU)) { throw "PIPER_MODEL_RU not found: $env:PIPER_MODEL_RU" }

& $pythonExe -m uvicorn app:app --host 127.0.0.1 --port 8002
