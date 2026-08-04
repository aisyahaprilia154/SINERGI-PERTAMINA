# PostgreSQL Live Recovery Preflight — 4 Agustus 2026

Status: `preflight complete; live restart/failover not executed`.

## Bukti read-only

- Windows service `postgresql-x64-18` terdeteksi `Running` dengan start type
  `Automatic`.
- `pg_isready -h 127.0.0.1 -p 5432 -t 1` melaporkan server accepting
  connections.
- `SINERGI_DATABASE_URL` tidak tersedia pada environment task dan tidak ada
  environment variable `SINERGI_*` untuk database/PostgreSQL yang dapat
  dipakai sebagai credential source.
- `npm run db:postgres-server-recovery` berhenti fail-closed dengan
  `database_url_required` sebelum membuka pool atau me-restart service.

## Batas dan tindakan yang diperlukan

Server ready bukan bukti autentikasi, schema, durability, atau recovery.
Live restart/failover membutuhkan `SINERGI_DATABASE_URL` dan otorisasi operator
untuk service yang tepat. Nilai credential tidak dicatat di repository atau
output evidence.
