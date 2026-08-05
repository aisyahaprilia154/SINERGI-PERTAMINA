$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

if ([string]::IsNullOrWhiteSpace($env:SINERGI_DATABASE_URL)) {
  $appUser = Read-Host 'PostgreSQL application user (default: sinergi_app)'
  if ([string]::IsNullOrWhiteSpace($appUser)) { $appUser = 'sinergi_app' }
  $securePassword = Read-Host 'Password application user' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $encodedPassword = [Uri]::EscapeDataString($plainPassword)
    $env:SINERGI_DATABASE_URL = "postgresql://$appUser`:$encodedPassword@127.0.0.1:5432/sinergi"
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $plainPassword = $null
    $encodedPassword = $null
  }
}

$env:SINERGI_SHADOW_DATABASE_URL = $env:SINERGI_DATABASE_URL

function Invoke-NpmCheck([string] $scriptName) {
  npm run $scriptName
  if ($LASTEXITCODE -ne 0) {
    throw "$scriptName gagal dengan exit code $LASTEXITCODE"
  }
}

Invoke-NpmCheck 'db:shadow-pilot'
Invoke-NpmCheck 'db:primary-pilot'
Invoke-NpmCheck 'db:concurrency'
Invoke-NpmCheck 'db:query-plan'

Write-Host 'Live verification selesai.' -ForegroundColor Green
