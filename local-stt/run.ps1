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

if (-not $env:STT_CUDA_DLL_DIR -and $env:KOKORO_CUDA_DLL_DIR) { $env:STT_CUDA_DLL_DIR = $env:KOKORO_CUDA_DLL_DIR }
if (-not $env:STT_MODEL_SIZE) { $env:STT_MODEL_SIZE = 'small' }
if (-not $env:STT_COMPUTE_TYPE) { $env:STT_COMPUTE_TYPE = 'int8' }
if (-not $env:STT_DEVICE -and $env:STT_COMPUTE_TYPE.ToLowerInvariant() -eq 'float16') {
  if ($env:STT_CUDA_DLL_DIR -and (Test-Path $env:STT_CUDA_DLL_DIR)) { $env:STT_DEVICE = 'cuda' }
}
if (-not $env:STT_DEVICE) { $env:STT_DEVICE = 'cpu' }
if ($env:STT_DEVICE.ToLowerInvariant() -eq 'cpu' -and $env:STT_COMPUTE_TYPE.ToLowerInvariant() -eq 'float16') {
  Write-Warning 'STT_DEVICE=cpu with STT_COMPUTE_TYPE=float16 is unsupported. Switching compute type to int8.'
  $env:STT_COMPUTE_TYPE = 'int8'
}

if ($env:STT_DEVICE.ToLowerInvariant() -eq 'cuda') {
  if ($env:STT_CUDA_DLL_DIR) {
    if (Test-Path $env:STT_CUDA_DLL_DIR) {
      $env:PATH = "$($env:STT_CUDA_DLL_DIR);$($env:PATH)"
    } else {
      Write-Warning "STT_CUDA_DLL_DIR does not exist: $env:STT_CUDA_DLL_DIR"
    }
  } else {
    Write-Warning 'STT_DEVICE=cuda but STT_CUDA_DLL_DIR is not set. Service may fail with missing cublas/cudnn DLLs.'
  }
}

& $pythonExe -m uvicorn app:app --host 127.0.0.1 --port 8001
