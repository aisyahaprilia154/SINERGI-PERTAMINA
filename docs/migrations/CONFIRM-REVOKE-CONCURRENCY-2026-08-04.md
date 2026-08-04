# Confirm/Revoke Concurrency — 4 Agustus 2026

Status: `complete (JSON state-machine contract; HTTP/PostgreSQL load pending)`.

## Perubahan bukti

- Regression memulai satu path attachment yang confirmed, lalu menjalankan
  revoke relation dan confirm candidate lain secara bersamaan.
- Record lock JSON mencegah lost update. Jika satu snapshot kalah pada
  `dataset_version_stale_revision`, test melakukan retry eksplisit dengan
  snapshot terbaru.
- Hasil akhir konsisten: candidate pertama `revoked`, candidate kedua
  `confirmed`, hanya satu active path-attachment relation tersisa, dan graph
  tidak memuat device edge parsial.
- Repository lock menangani `EPERM` transient pada Windows saat lock file
  sedang dilepas; kondisi tersebut di-retry sebagai contention.

## Verifikasi

- Test: `backend/tests/topology-review-hardening.test.js`.
- Suite topology-review-hardening lulus tiga kali berturut-turut.
- Full backend: `166/166` test lulus.
- Lint: `89` file JavaScript.
- Build: `37` source file.
- `git diff --check` lulus.

## Batas bukti

HTTP load, PostgreSQL multi-instance, dan regeneration/review race belum
tercakup. Retry pada checkpoint ini masih dilakukan oleh caller/test setelah
konflik optimistic revision; belum menjadi automatic client retry policy.
