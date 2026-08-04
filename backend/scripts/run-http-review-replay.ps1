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

node scripts/topology-http-review-replay.mjs

if ($LASTEXITCODE -ne 0) {
  throw "Live HTTP review replay gagal dengan exit code $LASTEXITCODE"
}

Write-Host 'Live HTTP review replay selesai.' -ForegroundColor Green
