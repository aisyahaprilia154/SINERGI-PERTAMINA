# PostgreSQL pool error boundary dan live verification stability - 4 Agustus 2026

Status: `complete (pool/runtime live verification scope)`.

## Scope

Subtask ini menutup error boundary pada PostgreSQL connection pool dan
memverifikasi ulang live pilot setelah sebuah run kedua mengalami process-level
failure. Ini bukan bukti PostgreSQL process restart/recovery.

## Root-cause evidence

- Run kedua `npm run db:live-verify` sebelumnya berhenti pada
  `db:concurrency` dengan exit code Windows `-1073740791` (`0xC0000409`).
- PostgreSQL log pada waktu yang sama mencatat dua koneksi client terputus
  paksa dan tidak mencatat database server crash.
- `createPostgresPool` sebelumnya tidak memasang listener `error`; error event
  pool idle dapat menjadi uncaught EventEmitter error pada proses Node.

## Change

- `backend/src/database/postgres-runtime.js` memasang listener `error` pada
  pool dan mencatat hanya kode/pesan error melalui logger yang diinjeksi.
- `backend/src/database/repository-runtime.js` meneruskan logger runtime ke
  pool factory.
- `backend/tests/database-runtime.test.js` memverifikasi listener terpasang
  dan logging tidak menyertakan connection string.

## Verification evidence

Credential tidak disimpan di repository.

- Targeted `npm run db:concurrency`: `passed`; PostgreSQL 18/PostGIS `3.6.2`,
  `successCount: 1`, `staleConflictCount: 1`,
  `unexpectedFailureCount: 0`, `finalRecordRevision: 1`.
- Rerun `npm run db:live-verify`: selesai sampai `Live verification selesai.`
- `db:primary-pilot`: storage mode `postgres`, repository
  `PostgresDatasetVersionRepository`, durable job `succeeded`,
  `jsonPrimaryUsed: false`.
- `db:query-plan`: seluruh 7 required indexes hadir; geometry, candidate, dan
  graph location memakai index scan pada pilot-sized query.
- `db:shadow-pilot`: `get`, `findActive`, dan `resolveActiveVersion` equal.
  Operasi `list` masih memiliki `record_extra_in_shadow` untuk row test
  historis, sehingga report keseluruhan `equal: false`; command tetap exit `0`
  dan tidak melakukan shadow write/publication.
- Backend local regression: `141/141` test, lint `78` file, build `36` source
  file, dan `git diff --check` lulus.

## Boundary

Checkpoint ini tidak membuktikan restart/recovery PostgreSQL, recovery setelah
database disconnect, retry idempotency lintas instance, backup disaster
recovery baru, atau SLO production-sized. Row test historis pada shadow perlu
diisolasi atau dibersihkan melalui prosedur database terkontrol sebelum exact
list parity dapat dinyatakan `equal: true`.
