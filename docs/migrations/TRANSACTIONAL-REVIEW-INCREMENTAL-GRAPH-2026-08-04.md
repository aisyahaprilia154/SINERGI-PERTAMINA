# Transactional review seam dan incremental graph rebuild - 4 Agustus 2026

Status: `complete (runtime/transaction-contract scope)`.

## Scope yang selesai

- `JsonDatasetVersionRepository.update()` sekarang memakai per-record lock,
  atomic rename, dan `recordRevision` untuk optimistic writer checks.
- `PostgresDatasetVersionRepository.update()` mempertahankan row lock
  `FOR UPDATE`, menerima `expectedRevision`, dan menaikkan revision payload
  secara konsisten.
- Candidate review mengirim dan memvalidasi `expectedGraphRevision` serta
  `expectedCandidateRevision` bila tersedia.
- Confirm, reject, skip, select-target, revoke, dan bulk review menggunakan
  state snapshot yang dicek kembali di dalam update callback.
- Rebuild review memakai `rebuildConfirmedRelationArtifacts()` dan
  `rebuildConfirmedGraphIncrementally()`. Candidate discovery spasial tidak
  dijalankan ulang untuk setiap keputusan review.
- Manual device relation hanya membuat explicit candidate yang diperlukan,
  kemudian menjalankan rebuild relation/graph yang sama.
- Response review memuat graph revision, candidate revision, dan record
  revision; UI mengirim snapshot tersebut pada mutation berikutnya.
- Mutation topology memakai satu transaction boundary untuk state change dan
  audit pada runtime PostgreSQL.

## Evidence lokal

- `backend/tests/topology-review-hardening.test.js`: equivalence terhadap
  full regeneration, dua reviewer berbeda tanpa lost update, konflik kandidat
  yang sama, dan stale aggregate writer.
- Test concurrency JSON membuktikan dua kandidat berbeda tersimpan bersama dan
  `recordRevision` bertambah dua kali.
- Test kandidat yang sama membuktikan tepat satu keputusan berhasil; keputusan
  lain berhenti dengan status konflik `409`.
- Full backend verification setelah transaction seam: `135/135` tests, lint
  `72` JavaScript files, dan build `35` source files lulus.
- Full frontend verification: `151/151` tests, lint `85` JavaScript files, dan
  production build lulus.
- PostgreSQL live concurrency check: dua writer memakai `expectedRevision: 0`;
  tepat satu berhasil dan satu berhenti dengan
  `dataset_version_stale_revision`. Tidak ada unexpected failure dan row
  sementara dibersihkan.
- PostgreSQL pilot migration, shadow read/compare, query plan, serta
  backup/restore lokal sudah lulus; lihat matrix live PostgreSQL.
- Transaction commit/rollback dan HTTP fault injection: lihat
  `TRANSACTIONAL-HTTP-REVIEW-AUDIT-2026-08-04.md`.

## Batas evidence

Replay end-to-end melalui live production-sized review API belum dilakukan.
Evidence 20 reviewer, retry idempotency, concurrent confirm/revoke melalui API,
durable full-regeneration worker, restart/recovery, dan production-sized SLO
tetap pending. Enterprise tetap `NO-GO` sampai production wiring dan evidence
tersebut tersedia.
