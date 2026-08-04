# PostgreSQL runtime dan shadow wiring — 4 Agustus 2026

Status: `complete (PostgreSQL primary + shadow runtime)`.

## Scope yang selesai

- `SINERGI_STORAGE_MODE=postgres` menjadikan PostgreSQL source of truth untuk
  dataset aggregate, durable job, dan audit event. Jika `SINERGI_DATABASE_URL`
  tersedia tanpa override mode, konfigurasi memilih mode `postgres` secara
  eksplisit; JSON hanya dipakai bila mode `json` dipilih.
- `SINERGI_STORAGE_MODE=shadow` membutuhkan
  `SINERGI_SHADOW_DATABASE_URL`; tanpa URL tersebut server berhenti fail-closed.
- Mode shadow tetap membungkus repository JSON dengan
  `ShadowDatasetVersionRepository`; PostgreSQL hanya menerima read/compare.
- Mode postgres memakai `PostgresDatasetVersionRepository`,
  `PostgresDurableJobRepository`, dan `PostgresAuditLog` pada pool yang sama.
  Tidak ada fallback runtime ke repository JSON ketika mode postgres aktif.
- Pool dibuat melalui dependency `pg` dengan batas pool, idle timeout,
  connection timeout, dan SSL yang eksplisit.
- Shutdown server menghentikan durable worker dan menutup pool shadow.
- Shutdown server pada mode postgres menghentikan worker dan menutup pool
  primary PostgreSQL.
- `npm run db:migrate` menjalankan migration dalam client transaction yang sama
  untuk setiap migration dan memverifikasi PostGIS, seluruh tabel projection,
  serta `dataset_active_pointers` setelah apply.
- `npm run db:pilot` menjalankan pilot migration dan parity count terhadap
  PostgreSQL nyata setelah schema tersedia.
- Rollback migration membutuhkan flag eksplisit `--confirm-down`.
- Migration `0003_postgres_runtime_state` menambahkan state lengkap durable job
  PostgreSQL: revision, progress, stage, lease timestamps, cancel flag, dan
  queue timestamps.

## Evidence lokal

- Regression terbaru setelah transaction seam: `npm test` 135/135 lulus.
- `npm run lint`: 72 file lulus.
- `npm run build`: 35 source file lulus.
- `npm run db:migrate` tanpa `SINERGI_DATABASE_URL` berhenti dengan
  `database_url_required`.
- `npm run db:pilot` tanpa `SINERGI_DATABASE_URL` berhenti dengan
  `database_url_required`.
- `git diff --check`: lulus.

## Live verification

- PostgreSQL 18 native service listens on `127.0.0.1:5432` and accepts the
  configured SCRAM credential.
- PostGIS is installed and enabled in the `sinergi` database.
- `npm run db:migrate` applied migrations `0001_operational_schema` and
  `0002_dataset_active_pointers` successfully.
- `npm run db:pilot` completed against the live database with exact parity for
  all 12 projection tables (`parity.equal: true`).
- `npm run db:primary-pilot` completed with runtime mode `postgres`, actual
  repository `PostgresDatasetVersionRepository`, PostgreSQL create/update,
  PostgreSQL durable-job claim/complete, and `jsonPrimaryUsed: false`.
- `npm run db:live-verify` completed shadow parity, primary pilot, live
  optimistic concurrency, and index/query-plan checks. Generated temporary
  rows were cleaned up.

## Batas evidence

PostgreSQL primary wiring, migration apply, row-count parity, shadow compare,
durable-job state, query plan, backup/restore, dan repository concurrency sudah
terbukti pada database lokal. Live HTTP replay, restart/recovery under failure,
production-sized load/SLO, canary, dan approval gates tetap pending.
