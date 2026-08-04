# Dataset and graph rollback pointer — 4 Agustus 2026

Status: `complete (JSON/lifecycle/API contract; PostgreSQL live drill pending)`.

## Contract

- `POST /api/admin/datasets/:datasetId/branches/:branchId/rollback` hanya
  dapat dipanggil Administrator.
- Service mengambil `previousVersionId` dari active pointer, memverifikasi
  `expectedActiveVersionId` untuk mencegah stale rollback, lalu mengaktifkan
  kembali versi archived secara atomic.
- Active pointer baru memiliki revision baru dan `previousVersionId` menunjuk
  versi yang baru saja digantikan; data lama tidak dihapus atau ditulis ulang.
- Validation, graph revision status, cache invalidation, dan audit event ikut
  publication boundary transaksi repository.
- Event sukses: `dataset_version.rolled_back`; failure:
  `dataset_version.rollback_failed`.

## Evidence

- `backend/tests/dataset-version-lifecycle.test.js`: rollback archived version,
  pointer revision, state active/archived, expected-active guard, dan audit.
- `backend/tests/dataset-rollback-api.test.js`: Administrator-only route,
  branch/dataset forwarding, dan expected-active payload.
- Full verification: `160/160` test, lint `86` file, build `37` source file,
  dan `git diff --check` lulus.

## Batas

Contract ini sudah mencakup adapter JSON dan route. PostgreSQL live transaction,
graph revision rows, backup/restore, operator runbook drill, dan production
approval belum menjadi bukti live.
