# Durable Job Double-Claim Guard — 5 Agustus 2026

Status: `complete (JSON multi-repository claim contract; PostgreSQL multi-instance pending)`.

## Perubahan bukti

- Dua `JsonDurableJobRepository` dengan root yang sama mensimulasikan dua
  worker/repository instance.
- Kedua worker memanggil `claimNext` secara bersamaan untuk satu job queued.
- Tepat satu claim berhasil; job menjadi `running`, `attemptCount=1`, dan
  `lockedBy` hanya berisi salah satu worker.
- Claim lock bersama diuji melalui race lintas instance, bukan hanya dua call
  pada object repository yang sama.

## Verifikasi

- Test: `backend/tests/durable-job-queue.test.js`.
- Suite durable-job-queue lulus lima kali berturut-turut.
- Full backend: `168/168` test lulus.
- Lint: `89` file JavaScript.
- Build: `37` source file.
- `git diff --check` lulus.

## Batas bukti

Ini belum membuktikan claim lintas proses PostgreSQL multi-instance atau
production worker load; live database tetap menunggu credential/operator.
