$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$backupDir = Join-Path (Get-Location) 'artifacts\database-backup'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupFile = Join-Path $backupDir "sinergi-live-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).dump"
$restoreDb = "sinergi_restore_check_$([guid]::NewGuid().ToString('N').Substring(0,8))"
$restoreCreated = $false

function Convert-SecurePassword([string] $label) {
  $secure = Read-Host $label -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Invoke-PgTool {
  param(
    [Parameter(Mandatory)] [string] $Executable,
    [Parameter(Mandatory)] [string] $User,
    [Parameter(Mandatory)] [string] $Password,
    [Parameter(Mandatory)] [string[]] $Arguments
  )
  $previousPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $Password
  try {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Executable gagal dengan exit code $LASTEXITCODE"
    }
  } finally {
    $env:PGPASSWORD = $previousPassword
  }
}

function Get-DatabaseSummary {
  param(
    [Parameter(Mandatory)] [string] $User,
    [Parameter(Mandatory)] [string] $Password,
    [Parameter(Mandatory)] [string] $Database
  )
  $sql = @'
SELECT json_build_object(
  'postgis', PostGIS_Full_Version(),
  'dataset_versions', (SELECT COUNT(*) FROM dataset_versions),
  'source_features', (SELECT COUNT(*) FROM source_features),
  'source_geometries', (SELECT COUNT(*) FROM source_geometries),
  'classified_objects', (SELECT COUNT(*) FROM classified_objects),
  'topology_candidates', (SELECT COUNT(*) FROM topology_candidates),
  'confirmed_relations', (SELECT COUNT(*) FROM confirmed_relations),
  'graph_revisions', (SELECT COUNT(*) FROM graph_revisions),
  'graph_nodes', (SELECT COUNT(*) FROM graph_nodes),
  'graph_edges', (SELECT COUNT(*) FROM graph_edges)
)::text;
'@
  $previousPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $Password
  try {
    $output = & "$pgBin\psql.exe" -h 127.0.0.1 -p 5432 -U $User -d $Database -w -At -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) {
      throw "psql summary gagal dengan exit code $LASTEXITCODE"
    }
    return ($output -join '').Trim() | ConvertFrom-Json
  } finally {
    $env:PGPASSWORD = $previousPassword
  }
}

$appPassword = Convert-SecurePassword 'Password sinergi_app'
$adminPassword = Convert-SecurePassword 'Password postgres admin'

try {
  Invoke-PgTool -Executable "$pgBin\pg_dump.exe" -User 'sinergi_app' -Password $appPassword -Arguments @(
    '-h', '127.0.0.1', '-p', '5432', '-U', 'sinergi_app', '-d', 'sinergi',
    '-w', '-Fc', '-f', $backupFile
  )

  Invoke-PgTool -Executable "$pgBin\createdb.exe" -User 'postgres' -Password $adminPassword -Arguments @(
    '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-w', $restoreDb
  )
  $restoreCreated = $true

  # The custom archive contains the PostGIS extension entry. Restore it into
  # the empty database so the extension is created exactly once.
  Invoke-PgTool -Executable "$pgBin\pg_restore.exe" -User 'postgres' -Password $adminPassword -Arguments @(
    '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', $restoreDb,
    '-w', '--exit-on-error', $backupFile
  )

  $source = Get-DatabaseSummary -User 'postgres' -Password $adminPassword -Database 'sinergi'
  $restored = Get-DatabaseSummary -User 'postgres' -Password $adminPassword -Database $restoreDb
  $fields = @(
    'dataset_versions', 'source_features', 'source_geometries',
    'classified_objects', 'topology_candidates', 'confirmed_relations',
    'graph_revisions', 'graph_nodes', 'graph_edges'
  )
  $mismatches = @($fields | Where-Object { [int64]$source.$_ -ne [int64]$restored.$_ })
  if ($mismatches.Count) {
    throw "Backup/restore count mismatch: $($mismatches -join ', ')"
  }

  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $backupFile
  [pscustomobject]@{
    result = 'passed'
    backupFile = $backupFile
    backupSha256 = $hash.Hash
    restoreDatabase = $restoreDb
    source = $source
    restored = $restored
  } | ConvertTo-Json -Depth 5
} finally {
  if ($restoreCreated -and $restoreDb -like 'sinergi_restore_check_*') {
    try {
      Invoke-PgTool -Executable "$pgBin\dropdb.exe" -User 'postgres' -Password $adminPassword -Arguments @(
        '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-w', '--if-exists', $restoreDb
      )
    } catch {
      Write-Error "Cleanup database restore gagal: $($_.Exception.Message)"
    }
  }
  $appPassword = $null
  $adminPassword = $null
}
