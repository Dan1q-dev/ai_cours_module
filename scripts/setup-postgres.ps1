param(
  [string] $EnvFile = '.env.local',
  [string] $DatabaseUrl = '',
  [switch] $CreateDatabase
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $projectRoot

function Read-EnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    if ($line -match "^\s*$Name=(.*)$") {
      return $Matches[1].Trim()
    }
  }

  return $null
}

if (-not $DatabaseUrl) {
  $envPath = Join-Path $projectRoot $EnvFile
  $DatabaseUrl = Read-EnvValue -Path $envPath -Name 'DATABASE_URL'
}

if (-not $DatabaseUrl) {
  throw "DATABASE_URL is not set. Add it to $EnvFile or pass -DatabaseUrl."
}

$env:DATABASE_URL = $DatabaseUrl
$dbUri = [System.Uri]$DatabaseUrl
$dbUserInfo = $dbUri.UserInfo.Split(':', 2)
$dbUser = $dbUserInfo[0]
$dbPassword = if ($dbUserInfo.Length -gt 1) { [System.Uri]::UnescapeDataString($dbUserInfo[1]) } else { '' }
$dbHost = $dbUri.Host
$dbPort = $dbUri.Port
$dbName = $dbUri.AbsolutePath.TrimStart('/')
$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlCommand) {
  throw 'psql is not installed or not available in PATH.'
}

if ($CreateDatabase) {
  $databaseName = $dbName
  if (-not $databaseName) {
    throw 'Unable to determine database name from DATABASE_URL.'
  }

  $adminBuilder = [System.UriBuilder]::new($dbUri)
  $adminBuilder.Path = '/postgres'
  $adminBuilder.Query = ''
  $adminUrl = $adminBuilder.Uri.AbsoluteUri.TrimEnd('/')

  $checkSql = "SELECT 1 FROM pg_database WHERE datname = '$databaseName';"
  if ($dbPassword) {
    $env:PGPASSWORD = $dbPassword
  }

  try {
    $existing = & $psqlCommand.Source $adminUrl -tAc $checkSql
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to query postgres for database '$databaseName'."
    }

    if ($existing.Trim() -ne '1') {
      & $psqlCommand.Source $adminUrl -c "CREATE DATABASE `"$databaseName`";"
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to create database '$databaseName'."
      }
      Write-Host "Created database '$databaseName'."
    } else {
      Write-Host "Database '$databaseName' already exists."
    }
  } finally {
    if ($dbPassword) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
  }
}

Write-Host 'Generating Prisma client...'
npm run prisma:generate
if ($LASTEXITCODE -ne 0) {
  throw 'prisma generate failed.'
}

if ($dbPassword) {
  $env:PGPASSWORD = $dbPassword
}

try {
  Write-Host 'Temporarily removing raw pgvector objects before prisma db push...'
  & $psqlCommand.Source -h $dbHost -p $dbPort -U $dbUser -d $dbName -c 'DROP INDEX IF EXISTS "idx_course_chunks_embedding_hnsw";'
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to drop pgvector index before prisma db push.'
  }

  & $psqlCommand.Source -h $dbHost -p $dbPort -U $dbUser -d $dbName -c 'ALTER TABLE "course_chunks" DROP COLUMN IF EXISTS "embedding_vector";'
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to drop embedding_vector column before prisma db push.'
  }
} finally {
  if ($dbPassword) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

Write-Host 'Pushing Prisma schema to PostgreSQL...'
npm run prisma:push
if ($LASTEXITCODE -ne 0) {
  throw 'prisma db push failed.'
}

if ($dbPassword) {
  $env:PGPASSWORD = $dbPassword
}

try {
  Write-Host 'Ensuring pgvector extension and vector column...'
  & $psqlCommand.Source -h $dbHost -p $dbPort -U $dbUser -d $dbName -c 'CREATE EXTENSION IF NOT EXISTS vector;'
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to enable pgvector extension in database '$dbName'. Install pgvector for your PostgreSQL instance and retry."
  }

  $dimension = Read-EnvValue -Path (Join-Path $projectRoot $EnvFile) -Name 'AI_VECTOR_DIMENSION'
  if (-not $dimension) {
    $dimension = '1536'
  }

  & $psqlCommand.Source -h $dbHost -p $dbPort -U $dbUser -d $dbName -c "ALTER TABLE `"course_chunks`" ADD COLUMN IF NOT EXISTS `"embedding_vector`" vector($dimension);"
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to add embedding_vector column to course_chunks.'
  }

  & $psqlCommand.Source -h $dbHost -p $dbPort -U $dbUser -d $dbName -c 'CREATE INDEX IF NOT EXISTS "idx_course_chunks_embedding_hnsw" ON "course_chunks" USING hnsw ("embedding_vector" vector_cosine_ops);'
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create pgvector index on course_chunks.embedding_vector.'
  }
} finally {
  if ($dbPassword) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

Write-Host 'PostgreSQL + Prisma setup completed.'
