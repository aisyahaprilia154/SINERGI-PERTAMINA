# Topology review mutation idempotency — 4 Agustus 2026

Status: `complete (local aggregate contract + HTTP wiring)`.

## Scope

Checkpoint ini memperluas retry idempotency dari single-candidate `confirm` ke
mutation topology lain yang dapat diulang setelah timeout atau response hilang:

- `select-target`;
- manual device relation;
- revoke relation;
- bulk confirm, line-label confirm, dan bulk revoke.

## Implementasi yang diverifikasi

- Header `Idempotency-Key` diteruskan oleh endpoint bulk, manual relation, dan
  revoke; endpoint candidate action tetap meneruskan header yang sama.
- Receipt disimpan di aggregate bersama perubahan topology. Fingerprint mengikat
  action, resource, actor, dan input mutation; reuse key untuk mutation berbeda
  ditolak.
- Replay mencari receipt sebelum validasi snapshot sehingga retry setelah
  `409`/stale revision tetap mengembalikan response commit pertama.
- Audit event dibuat setelah record lock dan validasi state, sehingga concurrent
  same-key request tidak menghasilkan audit event ganda.
- Receipt response dikanonicalisasi dan response request pertama membaca receipt
  yang baru ditulis; JSON repository dan PostgreSQL JSONB menghasilkan bentuk
  response yang sama.

## Evidence

- `backend/tests/topology-service.test.js`:
  sequential retry untuk select-target, manual relation, revoke, bulk confirm,
  dan bulk revoke; concurrent manual relation retry dengan serialized record
  lock.
- `backend/tests/topology-trace-api.test.js`: header idempotency diteruskan
  untuk manual relation dan bulk topology action.
- Backend test: `147/147` lulus.
- Backend lint: `81` file lulus.
- Backend build: `36` source file lulus.
- `git diff --check` lulus.

## Batas evidence

Evidence ini belum menyatakan enterprise readiness. PostgreSQL server
restart/failover, retry lintas instance production, 20-reviewer load, receipt
retention policy, dan production-sized SLO tetap pending.
