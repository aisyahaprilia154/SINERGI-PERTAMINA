# Transactional HTTP review dan audit — 4 Agustus 2026

Status: `complete (runtime + contract evidence)`.

## Perubahan

- `PostgresDatasetVersionRepository.withTransaction()` menyediakan scoped
  repository yang membaca dan menulis aggregate pada client PostgreSQL yang
  sama.
- `PostgresAuditLog.withExecutor(client)` mengarahkan insert audit ke client
  transaksi, bukan kembali ke pool.
- Mutation topology memakai seam transaksi tersebut untuk regenerate,
  confirm, reject, skip, select-target, manual relation, revoke, dan bulk
  review.
- Audit event, candidate/relation state, graph revision, dan projection
  aggregate sekarang commit atau rollback bersama.
- Repository transaction scope tetap fail-closed bila audit log transaksional
  tidak tersedia.

## Evidence

- `backend/tests/postgres-dataset-version-repository.test.js` membuktikan
  aggregate dan audit commit bersama pada transaction client yang sama.
- Test yang sama membuktikan rollback bersama saat audit insert gagal.
- `backend/tests/topology-review-hardening.test.js` menjalankan mutation melalui
  HTTP endpoint dan fault injection setelah aggregate write; hasilnya state
  kembali ke snapshot awal dan tidak ada audit event yang committed.
- Success path HTTP membuktikan `review.auditEventId` sama dengan audit entry
  yang committed.
- Backend verification: `135/135` test, lint `72` file, build `35` source
  file, dan `git diff --check` lulus.

## Batas evidence

Ini membuktikan wiring runtime dan HTTP contract/failure semantics. Replay
end-to-end terhadap production-sized live PostgreSQL API masih pending, karena
perlu environment database aplikasi yang disiapkan khusus untuk test tersebut.
Restart/recovery, idempotency retry, 20-reviewer load, SLO production,
security, canary, dan approval gates tetap pending.
