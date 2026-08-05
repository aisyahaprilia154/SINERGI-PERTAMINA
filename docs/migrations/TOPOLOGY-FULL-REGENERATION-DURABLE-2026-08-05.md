# Durable Full Topology Regeneration — 5 Agustus 2026

Status: `complete (durable JSON queue and replacement-worker contract; PostgreSQL multi-instance production pending)`.

## Implementasi

- `POST /api/dataset-versions/:id/topology/regenerate` sekarang membuat job
  durable `regenerate_full_topology` dan mengembalikan `202`.
- Request dengan idempotency key dan snapshot input yang sama menghasilkan satu
  job; request duplikat mengembalikan job yang sama.
- Handler terdaftar saat server start sehingga job yang tertinggal dapat
  diproses replacement worker setelah restart.
- Regenerasi mempertahankan audit event, topology run, graph revision, dan
  summary sebagai satu mutation transaction pada repository yang digunakan.

## Evidence

- Focused test:
  `backend/tests/topology-regeneration-job.test.js` — `1/1` lulus.
- Test membuktikan dua request idempotent menjadi satu job, job tetap queued
  sebelum worker pertama dijalankan, lalu replacement worker menyelesaikannya.
- Hasil persisted: `recordRevision=1`, satu `topologyRun`, satu graph revision,
  dan audit detail menyimpan job ID.
- Full backend: `171/171` test lulus.
- Lint: `90` file JavaScript.
- Build: `37` source file.
- `git diff --check` lulus.

## Batas bukti

Evidence ini menggunakan durable JSON queue dan replacement worker lokal. Ini
belum membuktikan PostgreSQL `FOR UPDATE SKIP LOCKED` multi-instance untuk
regenerasi, production worker load, API p95, dataset 10.000/50.000 objek,
cancel cooperative di tengah engine generation, atau SLO yang disetujui.
