# Local Pilot Status Reconciliation - 5 Agustus 2026

## Status

`complete` untuk evidence local PostgreSQL/pilot yang sudah tersedia;
constraint-negative test dan enterprise gates tetap pending.

## Reconciled evidence

- Dataset pilot `dv-pilot-parity` memiliki parity 12 projection table: dataset
  version `1`, source feature `3`, geometry `3`, classified object `3`, job `0`,
  candidate `1`, confirmed relation `1`, graph revision `1`, graph node `2`,
  graph edge `1`, accuracy evaluation `0`, dan audit event `0`.
- Migration `0001_operational_schema`, `0002_dataset_active_pointers`, dan
  `0003_postgres_runtime_state` sudah diterapkan pada local PostgreSQL target;
  primary pilot memakai `PostgresDatasetVersionRepository` dan
  `jsonPrimaryUsed=false`.
- Shadow pilot scoped pada fixture menghasilkan `comparisonCount=4` dan
  `equal=true`; required indexes tersedia dan query-plan pilot sudah direkam.
- Durable queue memiliki evidence restart/recovery, retry backoff, dead-letter,
  dan full-regeneration persistence pada checkpoint terpisah.

## Yang belum ditutup

Negative write test untuk foreign key/unique constraint belum dijalankan pada
turn ini karena `SINERGI_DATABASE_URL` dan otorisasi operator tidak tersedia di
proses Codex. Production-sized query plan, load/SLO, failover, DR retention,
security, dan organizational sign-off tetap pending.
