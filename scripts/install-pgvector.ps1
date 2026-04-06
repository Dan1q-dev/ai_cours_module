param(
  [string] $PgRoot = 'C:\Program Files\PostgreSQL\18',
  [string] $VersionTag = '0.8.2_18.0.2',
  [string] $AssetName = 'vector.v0.8.2-pg18.zip'
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session.'
  }
}

Assert-Administrator

if (-not (Test-Path $PgRoot)) {
  throw "PostgreSQL root not found: $PgRoot"
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tmpRoot = Join-Path $projectRoot 'tmp'
$zipPath = Join-Path $tmpRoot $AssetName
$extractDir = Join-Path $tmpRoot 'pgvector_pgsql_windows'
$downloadUrl = "https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/$VersionTag/$AssetName"

New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

Write-Host "Downloading $downloadUrl"
Invoke-WebRequest $downloadUrl -OutFile $zipPath

if (Test-Path $extractDir) {
  Remove-Item $extractDir -Recurse -Force
}

Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

Write-Host 'Copying extension files into PostgreSQL...'
Copy-Item (Join-Path $extractDir 'lib\vector.dll') (Join-Path $PgRoot 'lib\vector.dll') -Force
Copy-Item (Join-Path $extractDir 'share\extension\vector*') (Join-Path $PgRoot 'share\extension\') -Force

$includeTarget = Join-Path $PgRoot 'include\server\extension\vector'
New-Item -ItemType Directory -Force -Path $includeTarget | Out-Null
Copy-Item (Join-Path $extractDir 'include\server\extension\vector\*') $includeTarget -Force

Write-Host 'pgvector files installed into PostgreSQL.'
Write-Host 'Next steps:'
Write-Host '1. npm run db:setup'
Write-Host '2. npm run dev'
Write-Host '3. npm run test:api'
