$ErrorActionPreference = 'Stop'

$redis = Get-Command redis-server -ErrorAction SilentlyContinue

if (-not $redis) {
  Write-Host 'redis-server not found in PATH.'
  Write-Host 'Redis is optional. The AI module will continue to work with PostgreSQL only.'
  Write-Host 'To enable Redis later, set:'
  Write-Host '  AI_REDIS_ENABLED=true'
  Write-Host '  REDIS_URL=redis://127.0.0.1:6379'
  exit 0
}

& $redis.Source --version
if ($LASTEXITCODE -ne 0) {
  throw 'redis-server is installed but failed to start version check.'
}

Write-Host 'Redis binary detected. You can enable it in .env.local with:'
Write-Host '  AI_REDIS_ENABLED=true'
Write-Host '  REDIS_URL=redis://127.0.0.1:6379'
