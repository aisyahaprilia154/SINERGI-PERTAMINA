# Backup/restore PostgreSQL pilot runbook — 4 Agustus 2026

Status: `live verified on local pilot; production DR sign-off pending`.

Shortcut: from `backend`, run `npm run db:backup-restore`. The helper prompts
for the `sinergi_app` and `postgres` passwords without echoing them, performs
the same backup/restore/count checks, and cleans only its generated temporary
database.

Runbook ini sengaja memakai database restore sementara dengan prefix
`sinergi_restore_check_`. Jangan mengganti prefix tersebut sebelum cleanup.

## Live verification result

Pada 4 Agustus 2026, custom-format `pg_dump` dan `pg_restore` dijalankan
terhadap database pilot lokal. Restore ke database sementara berhasil, PostGIS
source dan restore sama-sama `3.6.2`, seluruh count projection sama, dan
database sementara dihapus setelah verifikasi. Backup artifact:
`backend/artifacts/database-backup/sinergi-live-20260804T042502Z.dump` dengan
SHA-256 `D63B33CE5F512F77BD3441B4FB1F0A8F0C0452CA8F27FD5E721BEC6BA938FAEA`.

Shortcut `npm run db:backup-restore` tetap menjadi prosedur operator yang
direkomendasikan; live evidence di atas dijalankan dengan urutan tool yang sama
secara non-interaktif karena credential tidak tersedia di environment agent.

## 1. Backup

Jalankan dari PowerShell pada terminal yang dapat meminta password:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$backupDir = Join-Path (Get-Location) 'artifacts\database-backup'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupFile = Join-Path $backupDir 'sinergi-live.dump'

& "$pgBin\pg_dump.exe" `
  -h 127.0.0.1 -p 5432 -U sinergi_app -d sinergi -W `
  -Fc -f $backupFile

if ($LASTEXITCODE -ne 0) { throw "pg_dump gagal dengan exit code $LASTEXITCODE" }
Get-Item -LiteralPath $backupFile | Select-Object FullName, Length
```

Simpan ukuran file backup dan checksum untuk evidence:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath $backupFile
```

## 2. Restore ke database bersih sementara

```powershell
$restoreDb = "sinergi_restore_check_$([guid]::NewGuid().ToString('N').Substring(0,8))"

& "$pgBin\createdb.exe" -h 127.0.0.1 -p 5432 -U postgres -W $restoreDb
if ($LASTEXITCODE -ne 0) { throw "createdb gagal dengan exit code $LASTEXITCODE" }

# Archive custom `pg_dump` membawa entry ekstensi PostGIS. Jangan membuat
# ekstensi lebih dulu; `pg_restore` akan membuatnya tepat satu kali pada
# database restore yang masih kosong.
& "$pgBin\pg_restore.exe" `
  -h 127.0.0.1 -p 5432 -U postgres -d $restoreDb -W `
  --exit-on-error $backupFile
if ($LASTEXITCODE -ne 0) { throw "pg_restore gagal dengan exit code $LASTEXITCODE" }
```

## 3. Verifikasi restore

```powershell
& "$pgBin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d $restoreDb -W `
  -v ON_ERROR_STOP=1 -c `
  "SELECT current_database(), PostGIS_Full_Version(); SELECT COUNT(*) AS dataset_versions FROM dataset_versions; SELECT COUNT(*) AS source_geometries FROM source_geometries; SELECT COUNT(*) AS graph_edges FROM graph_edges;"
```

Restore dianggap lulus jika command selesai tanpa error, PostGIS terdeteksi,
dan count tabel utama sama dengan database sumber.

## 4. Cleanup aman

```powershell
if ($restoreDb -notlike 'sinergi_restore_check_*') {
  throw "Nama database cleanup tidak aman: $restoreDb"
}

& "$pgBin\dropdb.exe" -h 127.0.0.1 -p 5432 -U postgres -W --if-exists $restoreDb
if ($LASTEXITCODE -ne 0) { throw "dropdb cleanup gagal dengan exit code $LASTEXITCODE" }
```

## Evidence yang harus dicatat

- backup file path, ukuran, dan SHA-256;
- restore database name sementara;
- PostGIS version pada restore;
- count `dataset_versions`, `source_geometries`, `topology_candidates`,
  `confirmed_relations`, `graph_revisions`, `graph_nodes`, dan `graph_edges`;
- exit code `0` untuk `pg_dump`, `pg_restore`, dan cleanup `dropdb`.
