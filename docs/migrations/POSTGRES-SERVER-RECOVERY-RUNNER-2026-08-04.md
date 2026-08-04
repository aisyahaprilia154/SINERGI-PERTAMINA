# PostgreSQL server recovery runner — 4 Agustus 2026

Status: `runner contract complete; live restart evidence pending`.

## Runner

- Orchestration contract: `backend/src/database/postgres-server-recovery.js`.
- Live command: `backend/scripts/database-postgres-server-recovery.mjs`.
- Command: `npm run db:postgres-server-recovery`.
- Service default: `postgresql-x64-18`.
- Readiness check: `pg_isready` tanpa menyimpan atau mencetak password.

Probe sequence:

1. Open pool baru dan verify PostGIS/runtime schema.
2. Fail closed jika queue memiliki job `queued`/`retry_wait` lain.
3. Create one uniquely fingerprinted durable probe job.
4. Close pool, restart service PostgreSQL, dan tunggu readiness.
5. Open pool pengganti, read job yang sama, claim, complete, dan enqueue ulang
   untuk membuktikan deduplication.
6. Delete hanya job probe yang dibuat runner.

## Contract evidence

- `backend/tests/postgres-server-recovery.test.js`: orchestration membuka store
  sebelum/sesudah restart, memulihkan job yang sama, menolak queue fixture yang
  tidak eksklusif, dan tidak memanggil restart ketika URL database hilang.
- Test contract: `5/5` lulus.
- Full backend verification setelah runner ditambahkan: `152/152` test, lint
  `84` file, build `37` source file, dan `git diff --check` lulus.
- Command live tanpa `SINERGI_DATABASE_URL` berhenti dengan
  `database_url_required` sebelum restart service.

## Batas dan checkpoint

Runner ini belum menjadi bukti PostgreSQL server restart/failover live. Live
execution memerlukan `SINERGI_DATABASE_URL` dengan kredensial yang diberikan
di environment eksekusi dan hak restart service. Password tidak boleh ditulis
ke repository, log, atau evidence. PostgreSQL failover/replica switchover,
multi-instance retry, dan disaster recovery tetap pending.
