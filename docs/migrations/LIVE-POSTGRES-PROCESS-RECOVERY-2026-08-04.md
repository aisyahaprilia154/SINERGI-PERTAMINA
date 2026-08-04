# Live PostgreSQL process-level durable job recovery - 4 Agustus 2026

Status: `complete (local PostgreSQL process-level lease recovery scope)`.

## Scope

Memverifikasi durable job PostgreSQL lintas process: process pertama berhenti
setelah claim, process pengganti membuka pool baru, lease yang kedaluwarsa
dipulihkan, dan job yang sama diselesaikan tanpa membuat job duplikat.

## Command dan evidence

Command yang dijalankan pada terminal dengan `SINERGI_DATABASE_URL` aktif:

```text
npm run db:postgres-process-recovery
```

Hasil live:

| Field | Value |
|---|---|
| PostgreSQL/PostGIS | PostgreSQL lokal / PostGIS `3.6.2` |
| Probe job | `live-pg-recovery-5bc3c999995b4621adfc510b60cb2a0b` |
| Crashed worker exit | `17` |
| Recovered job count | `1` |
| Final status | `succeeded` |
| Final attempt count | `2` |
| Final revision | `4` |
| Idempotency deduplicated | `true` |

Process pertama hanya claim job dan exit sebelum completion. Process pengganti
membuka pool baru, memanggil `recoverExpiredLeases`, claim ulang dengan worker
ID berbeda, lalu complete. Runner menghapus probe job pada cleanup `finally`.

## Local regression

- Backend test: `141/141` passed.
- Lint: 80 JavaScript files passed.
- Build: 36 source files passed.
- `git diff --check`: passed.

## Boundary

Evidence ini hanya membuktikan process-level lease recovery pada satu database
PostgreSQL lokal. Database server restart/failover, network disconnect retry,
multi-instance production load, duplicate relation prevention under recovery,
object storage failure, dan disaster-recovery restore tetap pending.
