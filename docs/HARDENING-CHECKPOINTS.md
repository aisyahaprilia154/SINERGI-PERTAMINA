# Hardening checkpoints

Dokumen ini mencatat task yang sudah diverifikasi dari rencana hardening.

## Checkpoint 1 — baseline reproducibility

Status: `complete` — 4 Agustus 2026.

- Golden snapshot: `backend/tests/fixtures/topology-baseline.snapshot.json`.
- Regression test: `backend/tests/topology-baseline-snapshot.test.js`.
- Benchmark command: `cd backend; npm run benchmark:topology`.
- Benchmark report: `docs/benchmarks/TOPOLOGY-BASELINE-2026-08-04.md`.
- Evidence: backend baseline 85/85; setelah snapshot ditambahkan 86/86.

## Checkpoint 2 — durable job state

Status: `complete` — 4 Agustus 2026.

- Repository: `backend/src/jobs/durable-job-repository.js`.
- Worker queue: `backend/src/jobs/durable-job-queue.js`.
- Job descriptor menyimpan type, dataset version, fingerprint, rule-set,
  status, attempts, lease, progress, error, dan result.
- Idempotency, lease recovery, retry, dead-letter, cancel, dan operator retry
  diuji pada `backend/tests/durable-job-queue.test.js`.
- Endpoint safe progress dan Administrator cancel/retry diuji pada
  `backend/tests/durable-job-api.test.js`.
- Production server memakai durable queue JSON hanya pada mode `json`/`shadow`;
  mode `postgres` memakai `PostgresDurableJobRepository` di PostgreSQL.
- Evidence: contract queue, live PostgreSQL primary pilot, dan cleanup row
  sementara lulus.

Batas checkpoint: mode PostgreSQL primary sudah tersedia; restart/recovery
multi-instance dan production load tetap menjadi evidence terpisah.

## Checkpoint 3 â€” candidate API pagination dan filter

Status: `complete` â€” 4 Agustus 2026.

- Query index: `backend/src/topology/topology-candidate-pagination.js`.
- Service/API: `backend/src/topology/topology-service.js` dan
  `backend/src/app.js`.
- Kontrak: default limit 100, maksimum 500, cursor opaque yang terikat pada
  score/id order, filter, graph revision, dan candidate revision.
- Filter status, site, network family, dan minimum score diproses server-side;
  response memiliki `pageInfo`, summary, graph/candidate revision, ETag,
  dan batas ukuran 2 MiB.
- UI memuat seluruh halaman hanya jika snapshot tetap sama; perubahan snapshot
  membatalkan pemuatan agar halaman tidak mencampur data dari dua revision.
- Backend evidence: 98/98 test, lint, dan build lulus.
- Frontend evidence: 151/151 test, lint, dan production build lulus.

Batas checkpoint: repository entity operasional masih JSON. PostgreSQL/PostGIS,
spatial index database, migrasi, backup/restore, query-plan database, dan load
test enterprise belum selesai.

## Checkpoint 4 — PostgreSQL/PostGIS migration contract

Status: `complete` — 4 Agustus 2026.

- Migration runner: `backend/src/database/migration-runner.js`.
- Up migration: `backend/src/database/migrations/0001_operational_schema.up.sql`.
- Down migration: `backend/src/database/migrations/0001_operational_schema.down.sql`.
- Schema mencakup dataset version, source feature/geometry, classified object,
  durable topology job, candidate, confirmed relation, graph revision/node/edge,
  accuracy evaluation, dan append-only audit event.
- PostGIS geometry serta GIST index, candidate BTREE index, unique constraint,
  foreign key, active graph revision guard, dan audit append-only trigger
  dideklarasikan dalam migration.
- Runner diuji untuk apply, idempotent re-run, rollback, checksum drift, dan
  rollback saat SQL gagal pada `backend/tests/database-migration.test.js`.
- Evidence: backend 102/102 test, lint 53 file, dan build 28 source file lulus.

Batas checkpoint: migration contract, pilot parity, repository shadow read,
query plan, dan backup/restore lokal sudah diverifikasi. Production cutover
tetap task terpisah.

## Checkpoint 5 — PostgreSQL repository adapter contract

Status: `complete` — 4 Agustus 2026.

- Repository: `backend/src/storage/postgres-dataset-version-repository.js`.
- Adapter mempertahankan aggregate JSONB sebagai compatibility payload dan
  menulis projection source, candidate, relation, serta graph dalam transaksi
  yang sama.
- CRUD menggunakan row lock saat update dan menjaga dataset version ID tetap
  immutable.
- Aktivasi memakai transaction advisory lock, `SELECT ... FOR UPDATE`, stale
  active-version check, active pointer upsert, dan rollback otomatis sebelum
  pointer dipublikasikan.
- Active pointer schema: `backend/src/database/migrations/0002_dataset_active_pointers.*.sql`.
- Contract test: `backend/tests/postgres-dataset-version-repository.test.js`.
- Evidence: backend 107/107 test, lint 55 file, dan build 29 source file lulus.

Batas checkpoint: adapter sudah menjadi source of truth pada runtime mode
`postgres`; atomic coupling audit dengan seluruh production review transaction,
restart/recovery, dan production load tetap belum selesai.

## Checkpoint 6 — pilot migration parity contract

Status: `complete (contract + local live pilot)` — 4 Agustus 2026.

- Pilot fixture: `backend/tests/fixtures/dataset-version-pilot.json`.
- Migrator dan count query: `backend/src/database/pilot-migration.js`.
- Test parity: `backend/tests/pilot-migration.test.js`.
- Fixture `dv-pilot-parity` mempunyai 3 source feature, 3 source geometry,
  3 classified object, 1 candidate, 1 confirmed relation, 1 graph revision,
  2 graph node, dan 1 graph edge.
- Parity check membaca seluruh 12 projection table; count mismatch menghasilkan
  `pilot_parity_failed` dan rollback dalam transaksi repository.
- Evidence report: `docs/migrations/DATASET-VERSION-PILOT-PARITY-2026-08-04.md`.
- Evidence: backend 112/112 test, lint 57 file, dan build 30 source file lulus.

Batas checkpoint: live JSON pilot migration, row-count parity, shadow compare,
query plan, dan backup/restore sudah lulus. Dataset produksi tetap pending.

## Checkpoint 7 — shadow mode read/compare

Status: `complete (contract + local live pilot)` — 4 Agustus 2026.

- Repository decorator: `backend/src/storage/shadow-dataset-version-repository.js`.
- Repository primary tetap menjadi source of truth; shadow repository hanya
  dipakai untuk read/compare.
- `get`, `list`, `findActive`, dan `resolveActiveVersion` menghasilkan report
  fingerprint yang deterministik tanpa mempublikasikan data shadow.
- Mismatch candidate, confirmed relation, graph component, unresolved,
  active pointer, missing/extra record, dan duplicate ID dilaporkan tanpa
  mengirim payload sumber.
- Shadow read failure bersifat fail-open terhadap hasil primary tetapi tidak
  disembunyikan dari report.
- `create`, `update`, dan `activateVersionAtomically` hanya memanggil primary;
  test memastikan shadow tidak menerima write atau activation.
- Test contract: `backend/tests/shadow-dataset-version-repository.test.js`.
- Evidence: `docs/migrations/SHADOW-MODE-READ-COMPARE-2026-08-04.md`.
- Evidence: backend 129/129 test, lint 68 file, dan build 33 source file lulus.

Batas checkpoint: restart/recovery, production-sized load/concurrency, dan
canary publication tetap pending.

## Checkpoint 8 — spatial prefilter dan indexed junction lookup

Status: `complete (code/regression scope)` — 4 Agustus 2026.

- Overlap linework memakai segment grid untuk membuat pasangan kandidat;
  global path × path scan pada jalur tersebut dihapus.
- Intersection junction lookup memakai node grid radius query; global
  `nodes.filter(...)` per intersection dihapus.
- Pemeriksaan presisi, compatibility, dan determinisme tetap dipertahankan.
- Regression test partial overlap ditambahkan di
  `backend/tests/semantic-relation-engine.test.js`.
- Baseline snapshot tetap sama di
  `backend/tests/topology-baseline-snapshot.test.js`.
- Evidence: `docs/benchmarks/TOPOLOGY-SPATIAL-PREFILTER-2026-08-04.md`.
- Evidence: backend 118/118 test, lint 59 file, dan build 31 source file lulus.

Batas checkpoint: ini belum membuktikan query plan PostGIS, dense/long-line
stress, 50.000-object SLO, atau kapasitas production worker. Runtime PostGIS
lokal sudah tersedia; verifikasi workload live tetap pending.

## Checkpoint 9 — PostgreSQL runtime seam dan shadow wiring

Status: `complete (runtime primary + shadow)` — 4 Agustus 2026.

- Runtime: `backend/src/database/postgres-runtime.js` dan
  `backend/src/database/repository-runtime.js`.
- Dependency PostgreSQL: `pg` pada `backend/package.json` dan lockfile.
- `SINERGI_STORAGE_MODE=postgres` memakai PostgreSQL sebagai source of truth;
  jika `SINERGI_DATABASE_URL` tersedia tanpa override mode, konfigurasi memilih
  mode postgres. JSON tetap tersedia hanya sebagai mode eksplisit untuk fixture.
- Mode shadow harus diaktifkan eksplisit dengan `SINERGI_STORAGE_MODE=shadow`
  dan `SINERGI_SHADOW_DATABASE_URL`.
- Shadow repository hanya read/compare; write dan activation tetap ke primary.
- Mode postgres memakai `PostgresDatasetVersionRepository`,
  `PostgresDurableJobRepository`, dan `PostgresAuditLog` pada pool yang sama.
- Pool ditutup saat shutdown server.
- Migration command: `backend/scripts/database-migrate.mjs`.
- Pilot command: `backend/scripts/database-pilot.mjs`; primary runtime pilot:
  `backend/scripts/database-primary-pilot.mjs`.
- Evidence: `docs/migrations/POSTGRES-RUNTIME-SHADOW-WIRING-2026-08-04.md`.
- Evidence: backend 135/135 test, lint 72 file, dan build 35 source file lulus.

Batas checkpoint: migration apply, pilot row-count, shadow compare, query plan,
backup/restore, dan repository concurrency terhadap PostgreSQL 18/PostGIS lokal
sudah lulus. Live HTTP replay, restart/recovery, production load/SLO, dan
approval gates tetap pending.

## Checkpoint 10 - transactional review seam dan incremental graph rebuild

Status: `complete (runtime/transaction-contract scope)` - 4 Agustus 2026.

- Repository JSON memakai per-record lock, atomic update, dan `recordRevision`;
  adapter PostgreSQL mempertahankan `FOR UPDATE` serta expected revision check.
- Review mutation memvalidasi graph/candidate snapshot dan tidak kehilangan
  perubahan reviewer berbeda pada record yang sama.
- Confirm, reject, skip, select-target, revoke, bulk review, dan manual device
  relation memakai rebuild relation/graph tanpa candidate discovery spasial
  penuh pada setiap klik.
- Graph rebuild hanya menghitung ulang component yang terkena dampak dan
  menggabungkannya dengan component lama yang tidak berubah.
- UI mengirim `expectedGraphRevision` dan `expectedCandidateRevision` pada
  mutation topology.
- Evidence: `docs/migrations/TRANSACTIONAL-REVIEW-INCREMENTAL-GRAPH-2026-08-04.md`
  dan `backend/tests/topology-review-hardening.test.js`.
- Transaction seam: `docs/migrations/TRANSACTIONAL-HTTP-REVIEW-AUDIT-2026-08-04.md`;
  PostgreSQL aggregate dan audit memakai client transaksi yang sama.
- Evidence verification: backend `135/135` test, lint `72` file, build `35`
  source file; frontend `151/151` test, lint `85` file, production build;
  `git diff --check` lulus.

Batas checkpoint: contract transaction dan HTTP fault injection sudah lulus;
replay end-to-end terhadap live production-sized PostgreSQL API belum
dijalankan. Local PostgreSQL primary, credential, PostGIS, migration, shadow
compare, query plan, backup/restore, dan repository concurrency sudah lulus.
20-reviewer load, retry idempotency, concurrent confirm/revoke melalui API,
durable full-regeneration worker, restart/recovery, dan production SLO tetap
pending.

## Status berikutnya

Task berikutnya adalah live HTTP replay, restart/recovery, load/SLO, dan
enterprise approval gates. Setiap
checkpoint hanya boleh ditandai selesai setelah test, lint/build, dan regression
evidence lulus; bukti live database harus dilaporkan terpisah dari test
contract. Bukti lokal yang sudah lulus tidak mengubah status enterprise `NO-GO`
sebelum production cutover, recovery, security, dan approval gates selesai.
