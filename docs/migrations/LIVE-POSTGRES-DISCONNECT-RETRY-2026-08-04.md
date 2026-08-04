# Live PostgreSQL disconnect retry - 4 Agustus 2026

Status: `complete (isolated PostgreSQL mutation disconnect scope)`.

## Scope

Memverifikasi mutation topology PostgreSQL ketika koneksi client terputus tepat
sebelum `COMMIT`. Karena hasil commit menjadi ambigu bagi client, probe
mengulangi mutation `confirm` dengan idempotency key yang sama dan memastikan
replay tidak membuat relation atau audit event ganda.

## Command dan evidence

Command dijalankan pada terminal dengan `SINERGI_DATABASE_URL` aktif:

```text
npm run db:postgres-disconnect-retry
```

Hasil live:

| Field | Value |
|---|---|
| PostgreSQL/PostGIS | PostgreSQL lokal / PostGIS `3.6.2` |
| Dataset probe | `live-db-disconnect-0caf3b43ee3849afb85ff014ae2bc42e` |
| Candidate probe | `candidate:9901e7322f5df2ae5f0ecf3f` |
| First outcome | `Connection terminated unexpectedly` |
| Fault injected | `true` |
| Retry record revision | `1` |
| Replay matches retry | `true` |
| New relation count | `1` |
| Confirmed relation count | `2` |
| Unique confirmed relation count | `2` |
| Audit event count | `1` |
| Validated graph revision count | `1` |

Request pertama gagal menerima hasil karena disconnect. Retry dengan input dan
idempotency key yang sama menemukan/menyelesaikan mutation yang sama; replay
berikutnya mengembalikan response identik. Response mutation dibuat canonical
terhadap serialisasi JSONB sehingga field `undefined` tidak membedakan response
pertama dari receipt replay.

Dataset probe dipertahankan karena audit log append-only; dataset tetap
unpublished dan tidak menjadi graph aktif.

## Local regression

- Backend test: `142/142` passed.
- Lint: 81 JavaScript files passed.
- Build: 36 source files passed.
- `git diff --check`: passed.

## Boundary

Evidence ini membuktikan disconnect-before-commit retry pada satu mutation
candidate dan satu database PostgreSQL lokal. PostgreSQL server
restart/failover, retry lintas instance, multi-worker production load, object
storage failure, dan disaster-recovery restore tetap pending.
