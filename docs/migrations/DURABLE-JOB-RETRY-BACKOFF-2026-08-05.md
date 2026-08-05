# Durable Job Retry, Lease Recovery, dan Dead-Letter - 5 Agustus 2026

## Status

`complete` untuk durable JSON queue contract; PostgreSQL multi-instance retry
load, alerting, retention, dan production worker SLO tetap pending.

## Evidence

- `expired worker lease is recovered and executed by the next worker` membuktikan
  lease worker yang mati dilepas dan job dilanjutkan worker pengganti dengan
  attempt berikutnya.
- `retryable job uses exponential backoff and dead-letters after maximum
  attempts` memakai controlled clock dan membuktikan retry tersedia setelah
  `1.000 ms`, lalu `2.000 ms`, kemudian status menjadi `dead_letter` pada
  attempt ketiga dari maksimum tiga attempt.
- `poison job enters dead-letter and operator retry resets the attempt state`
  membuktikan error non-retryable masuk dead-letter dan retry Administrator
  mengembalikan job ke `queued` dengan `attemptCount=0`.
- Targeted suite `tests/durable-job-queue.test.js`: `6/6` pass.
- Full backend verification: `176/176` test, lint `91` file, build `37` source
  file, dan `git diff --check` lulus.

## Batas

Recovery live PostgreSQL sudah dibuktikan di checkpoint terpisah, tetapi
backoff/dead-letter lintas instance PostgreSQL, worker fleet production,
dashboard/alert, retention, dan SLO belum dibuktikan oleh checkpoint ini.
