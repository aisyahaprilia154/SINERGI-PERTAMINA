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
backup/restore, repository concurrency, dan live HTTP pilot replay terhadap
PostgreSQL 18/PostGIS lokal sudah lulus. Restart/recovery, production load/SLO,
dan approval gates tetap pending.

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

Batas checkpoint: contract transaction, HTTP fault injection, dan live pilot
HTTP replay sudah lulus. Replay production-sized, 20-reviewer load, retry
idempotency, concurrent confirm/revoke melalui API, durable full-regeneration
worker, restart/recovery, dan production SLO tetap pending.

## Checkpoint 11 - topology input-order determinism

Status: `complete` - 4 Agustus 2026.

- Property test: `backend/tests/topology-determinism.test.js`.
- Test menjalankan 12 permutasi deterministik atas classified node, classified
  path, geometry, dan explicit relation.
- Setiap permutasi menghasilkan artifact topology yang sama dengan baseline,
  dengan `generatedAt` dan input fixture yang sama.
- Evidence: backend `136/136` test, lint `73` file, build `35` source file,
  dan `git diff --check` lulus.

Batas checkpoint: property ini belum menggantikan fuzz geometry, compatibility
matrix test, atau load test production-sized.

## Checkpoint 12 - live PostgreSQL HTTP review replay

Status: `complete (pilot fixture)` - 4 Agustus 2026.

- Runner: `backend/scripts/topology-http-review-replay.mjs` dan command
  `npm run db:http-review-replay`.
- Regression menemukan dan memperbaiki mismatch graph revision antara response
  candidate/summary API dan mutation snapshot contract.
- Dua confirm HTTP concurrent dengan snapshot yang sama menghasilkan tepat
  satu `200` dan satu `409 stale_topology_review`.
- PostgreSQL projection setelah winner: satu audit event, dua confirmed
  relation, satu graph revision `validated`, dan nol graph revision `active`.
- Dataset evidence `live-http-review-1104b8d100444503a078847c3a646a45`
  dipertahankan karena audit log append-only; dataset tetap unpublished dan
  tidak menjadi graph aktif.
- Evidence report:
  `docs/migrations/LIVE-HTTP-REVIEW-REPLAY-2026-08-04.md`.
- Verification: backend `137/137` test, lint `74` file, build `35` source file,
  dan `git diff --check` lulus.

Batas checkpoint: fixture ini kecil. Replay production-sized, 20 reviewer,
retry idempotency, concurrent confirm/revoke, PostgreSQL restart-recovery, dan
SLO tetap pending.

## Checkpoint 13 - process-level worker restart recovery

Status: `complete (durable JSON worker scope)` - 4 Agustus 2026.

- Worker fixture: `backend/tests/fixtures/durable-job-process-worker.mjs`.
- Test: `backend/tests/durable-job-process-recovery.test.js`.
- Child process sengaja berhenti setelah job berhasil di-claim tanpa menulis
  completion. Worker pengganti membuka root durable yang sama dan mengambil
  lease setelah kedaluwarsa.
- Job yang sama selesai pada attempt kedua; artifact ditulis tepat satu kali
  dengan create-only write; enqueue ulang dengan input fingerprint dan
  rule-set yang sama tetap mengembalikan job yang sama sebagai deduplicated.
- Evidence: test terisolasi lulus 3/3 pengulangan; backend `138/138` test,
  lint `76` file, build `35` source file, dan `git diff --check` lulus.

Batas checkpoint: ini membuktikan restart worker pada durable JSON queue.
PostgreSQL live recovery/multi-instance, database disconnect, object storage
failure, dan retry idempotency pada mutation HTTP belum selesai.

## Checkpoint 14 - HTTP review retry idempotency

Status: `complete (single-candidate JSON aggregate scope)` - 4 Agustus 2026.

- Idempotency helper: `backend/src/topology/topology-idempotency.js`.
- Service: single-candidate `confirm`, `reject`, dan `skip` menyimpan receipt
  bersama aggregate, dengan fingerprint action/resource/actor/input.
- API membaca header `Idempotency-Key`. Retry confirm dengan key dan payload
  yang sama mengembalikan response commit pertama tanpa audit event atau
  confirmed relation tambahan.
- Reuse key untuk payload berbeda ditolak dengan `409 idempotency_key_reused`.
- Evidence: `backend/tests/topology-review-hardening.test.js`; backend
  `139/139` test, lint `77` file, build `36` source file, dan
  `git diff --check` lulus.

Batas checkpoint: bukti HTTP langsung mencakup confirm pada JSON aggregate.
Bulk review, select-target, manual relation, revoke, PostgreSQL live replay,
dan receipt retention policy production tetap pending. Concurrent same-key
request mempunyai checkpoint terpisah pada Checkpoint 15.

## Checkpoint 15 - concurrent same-key HTTP review idempotency

Status: `complete (single-candidate JSON aggregate scope)` - 4 Agustus 2026.

- Service memakai expected aggregate revision hanya ketika mutation membawa
  idempotency key.
- Request kedua yang tiba saat request pertama masih memegang record lock
  tidak menaikkan `recordRevision`, tidak menulis audit event kedua, dan
  mengembalikan receipt response yang sama setelah stale revision terdeteksi.
- Test HTTP menahan audit request pertama, memastikan request kedua benar-benar
  masuk ke jalur concurrent update, lalu memverifikasi dua response `200` yang
  identik, satu audit event, satu confirmed relation, satu receipt, dan
  `recordRevision = 1`.
- Test yang sama lulus 3/3 pengulangan.
- Evidence: `backend/tests/topology-review-hardening.test.js`; backend
  `140/140` test, lint `77` file, build `36` source file, dan
  `git diff --check` lulus.

Batas checkpoint: scope masih JSON aggregate single-candidate. Bulk review,
select-target, manual relation, revoke, PostgreSQL live replay, multi-instance
recovery, dan receipt retention policy production tetap pending.

## Checkpoint 16 - API restart recovery pada durable JSON queue

Status: `complete (process-level JSON runtime scope)` - 4 Agustus 2026.

- Test proses: `backend/tests/api-restart-recovery.test.js` menjalankan server
  nyata, menerima upload Administrator, memastikan descriptor job tersimpan,
  menghentikan proses API, lalu menyalakan proses API kedua dengan data root
  yang sama.
- Endpoint job dan status dataset setelah restart tetap menemukan job ID dan
  dataset version ID yang sama; job dapat mencapai state terminal tanpa
  kehilangan descriptor atau idempotency key.
- Runtime JSON menerima `SINERGI_JOB_LOCK_STALE_MS` dan meneruskannya ke
  repository durable. Retry lock memakai timer yang tetap aktif agar startup
  tidak keluar dengan top-level await unresolved ketika membersihkan stale
  lock.
- Test proses lulus 3/3 pengulangan.
- Evidence: backend `141/141` test, lint `78` file, build `36` source file,
  dan `git diff --check` lulus.

Batas checkpoint: hanya process-level JSON runtime. PostgreSQL live
restart/recovery, database disconnect, object storage failure, multi-instance
coordination, dan production lock/lease policy tetap pending.

## Checkpoint 17 - PostgreSQL pool error boundary dan live verification stability

Status: `complete (pool/runtime live verification scope)` - 4 Agustus 2026.

- `createPostgresPool` sekarang memasang listener `error` pada pool dan
  meneruskan logger runtime; error client idle tidak lagi dibiarkan menjadi
  uncaught EventEmitter error.
- Regression awal: run kedua live verification berhenti pada `db:concurrency`
  dengan exit code Windows `0xC0000409`; PostgreSQL hanya mencatat koneksi
  client terputus paksa, bukan server database crash.
- Setelah perubahan, targeted `db:concurrency` lulus dengan satu writer sukses,
  satu `dataset_version_stale_revision`, dan nol unexpected failure.
- Rerun penuh `db:live-verify` selesai sampai `Live verification selesai.`;
  primary PostgreSQL, concurrency, required indexes, dan index-scan query plan
  lulus pada PostgreSQL 18/PostGIS `3.6.2`.
- Regression evidence lokal: backend `141/141` test, lint `78` file, build
  `36` source file, dan `git diff --check` lulus.
- Evidence terpisah: `docs/migrations/LIVE-POSTGRES-POOL-ERROR-BOUNDARY-2026-08-04.md`.

Batas checkpoint: `db:shadow-pilot` tetap melaporkan `record_extra_in_shadow`
untuk row test historis, termasuk satu row dari run yang crash; `get`, active
lookup, primary pilot, concurrency, dan query plan lulus. Checkpoint ini belum
membuktikan PostgreSQL process restart/recovery, database disconnect recovery,
retry lintas instance, atau production-sized SLO.

## Checkpoint 18 - PostgreSQL process-level durable job restart/recovery

Status: `complete (local PostgreSQL process-level lease recovery scope)` - 4 Agustus 2026.

- Runner live: `backend/scripts/database-postgres-process-recovery.mjs`,
  command `npm run db:postgres-process-recovery`.
- Child process pertama membuka pool PostgreSQL, claim job, menulis bukti claim,
  lalu exit code `17` tanpa menyelesaikan job.
- Replacement process membuka pool baru, menemukan lease kedaluwarsa,
  memulihkan `1` job, claim ulang, dan complete.
- Live evidence: PostgreSQL 18/PostGIS `3.6.2`; final status `succeeded`,
  `finalAttemptCount = 2`, `finalRevision = 4`, dan enqueue ulang
  `idempotencyDeduplicated = true`.
- Runner membersihkan job probe yang dibuatnya pada `finally`; fixture menolak
  memulai jika queue memiliki job `queued`/`retry_wait` lain agar tidak
  memproses pekerjaan di luar scope.
- Regression evidence lokal: backend `141/141` test, lint `80` file, build
  `36` source file, dan `git diff --check` lulus.
- Evidence terpisah: `docs/migrations/LIVE-POSTGRES-PROCESS-RECOVERY-2026-08-04.md`.

Batas checkpoint: bukti ini memakai satu database PostgreSQL lokal dan satu
job probe; belum membuktikan PostgreSQL server restart/failover, multi-instance
production load, object storage recovery, atau disaster recovery backup/restore.

## Checkpoint 19 - PostgreSQL disconnect retry tanpa duplicate relation

Status: `complete (isolated PostgreSQL mutation disconnect scope)` - 4 Agustus 2026.

- Runner live: `backend/scripts/database-postgres-disconnect-retry.mjs`,
  command `npm run db:postgres-disconnect-retry`.
- Fault injection memutus stream client tepat sebelum `COMMIT`; request pertama
  menerima `Connection terminated unexpectedly`, sehingga outcome commit menjadi
  ambigu dari sisi client.
- Retry mutation `confirm` dengan actor, input, dan idempotency key yang sama
  berhasil; replay berikutnya identik (`replayMatchesRetry = true`).
- Live evidence: PostgreSQL/PostGIS `3.6.2`, dataset
  `live-db-disconnect-0caf3b43ee3849afb85ff014ae2bc42e`, satu relation baru,
  `2` confirmed relation total, `2` unique relation, `1` audit event, dan `1`
  validated graph revision.
- Receipt response sekarang canonical terhadap JSONB/HTTP JSON; property
  `undefined` tidak membuat response pertama berbeda dari replay PostgreSQL.
- Regression evidence lokal: backend `142/142` test, lint `81` file, build
  `36` source file, dan `git diff --check` lulus.
- Evidence terpisah: `docs/migrations/LIVE-POSTGRES-DISCONNECT-RETRY-2026-08-04.md`.

Batas checkpoint: bukti ini menguji satu mutation candidate pada satu database
PostgreSQL lokal dengan disconnect sebelum commit. PostgreSQL server
restart/failover, retry lintas instance, multi-worker production load, object
storage recovery, dan disaster recovery backup/restore tetap pending.

## Checkpoint 20 - topology review mutation idempotency yang diperluas

Status: `complete (local aggregate contract + HTTP wiring)` - 4 Agustus 2026.

- `Idempotency-Key` diteruskan oleh endpoint bulk topology, manual relation,
  dan revoke; candidate action tetap mempertahankan header yang sama.
- Receipt/fingerprint sekarang mencakup `select-target`, manual device
  relation, single revoke, bulk confirm, line-label confirm, dan bulk revoke.
- Receipt mengikat action, resource, actor, dan input; reuse key untuk mutation
  berbeda ditolak.
- Replay dilakukan sebelum snapshot validation dan setelah stale revision,
  sehingga retry mengembalikan response commit pertama tanpa relation atau
  audit event ganda.
- Audit event mutation diperoleh setelah record lock dan validasi state; uji
  concurrent manual relation membuktikan satu pemenang, satu relation, satu
  audit event, dan response identik.
- Evidence: `docs/migrations/TOPOLOGY-REVIEW-IDEMPOTENCY-2026-08-04.md`;
  `backend/tests/topology-service.test.js`;
  `backend/tests/topology-trace-api.test.js`.
- Verification: backend `147/147` test, lint `81` file, build `36` source
  file, dan `git diff --check` lulus.

Batas checkpoint: scope live PostgreSQL masih mencakup satu mutation
disconnect-before-commit pada Checkpoint 19. PostgreSQL server failover,
retry lintas instance, 20-reviewer load, receipt retention policy production,
dan production-sized SLO tetap pending.

## Checkpoint 21 - PostgreSQL server recovery runner

Status: `complete (runner contract; live restart evidence pending)` - 4 Agustus 2026.

- Orchestration contract: `backend/src/database/postgres-server-recovery.js`.
- Live command: `backend/scripts/database-postgres-server-recovery.mjs`;
  package command `npm run db:postgres-server-recovery`.
- Runner membuka pool sebelum dan sesudah restart, memverifikasi schema,
  membuat probe durable job yang fingerprint-nya unik, menutup pool sebelum
  restart, menunggu `pg_isready`, lalu claim/complete job yang sama dan
  memverifikasi enqueue deduplication.
- Fixture menolak queue `queued`/`retry_wait` yang tidak kosong dan cleanup
  hanya menghapus job probe milik runner.
- Contract evidence: `backend/tests/postgres-server-recovery.test.js`, `5/5`
  lulus. Command live tanpa `SINERGI_DATABASE_URL` berhenti dengan
  `database_url_required` sebelum restart service.
- Full backend verification: `152/152` test, lint `84` file, build `37`
  source file, dan `git diff --check` lulus.
- Evidence terpisah: `docs/migrations/POSTGRES-SERVER-RECOVERY-RUNNER-2026-08-04.md`.

Batas checkpoint: ini belum membuktikan PostgreSQL server restart/failover
live. Eksekusi live memerlukan connection string/kredensial dan hak restart
service pada environment operator; failover/replica switchover, multi-instance
retry, dan disaster recovery tetap pending.

## Checkpoint 22 - Repository benchmark fixture dan command

Status: `complete (fixture/command scope)` - 4 Agustus 2026.

- Checklist plan untuk fixture dan command benchmark ditandai selesai.
- Fixture tersimpan di `backend/tests/fixtures/topology-baseline-fixture.js`
  dengan snapshot regression di `backend/tests/fixtures/topology-baseline.snapshot.json`.
- Command tersimpan di `backend/benchmarks/topology-baseline.mjs` dan package
  script `npm run benchmark:topology`.
- Re-run `npm run benchmark:topology -- --sizes=1000,2000,4000` lulus dengan
  `validationErrors: 0`, candidate `0`, dan output JSON untuk seluruh ukuran;
  detail dicatat di `docs/benchmarks/TOPOLOGY-BASELINE-2026-08-04.md`.
- Command guarded `npm run benchmark:topology:guarded` tersedia untuk sparse
  10.000 path dengan budget runtime `60.000 ms` dan peak RSS `512 MiB`; budget
  violation menghasilkan exit non-zero dan diagnostic terstruktur.
- Batas evidence: fixture ini sparse dan belum membuktikan dense,
  intersection-heavy, long-line, ambiguous-heavy, 10.000/50.000 object,
  concurrent API p95, atau enterprise SLO.

## Checkpoint 23 - Guarded sparse benchmark dan resource report

Status: `complete (local guarded benchmark scope; enterprise SLO pending)` -
4 Agustus 2026.

- Runner benchmark kini melaporkan fixture-build time, wall-clock runtime, CPU
  user/system, current/peak RSS, runtime platform, dan budget violations.
- Command `npm run benchmark:topology:guarded` menjalankan 10.000 sparse path
  dengan budget runtime `60.000 ms` dan peak RSS `512 MiB`.
- Evidence lokal: runtime `704,096 ms`, peak RSS `250,45 MiB`, CPU
  `766/203 ms`, candidate `0`, validation error `0`, dan budget violations
  kosong.
- Contract test `backend/tests/topology-benchmark.test.js`: `3/3` lulus;
  full backend verification sesudah perubahan: `155/155` test, lint `85` file,
  build `37` source file.
- Budget failure menghasilkan exit non-zero dan diagnostic terstruktur; ini
  diuji terpisah dengan budget runtime yang sengaja terlalu kecil.

Batas checkpoint: ini hanya in-process JavaScript sparse fixture. Belum ada
bukti dense/intersection-heavy/long-line/ambiguous-heavy, 50.000 stress yang
aman pada worker target, database I/O, queue depth, concurrent API p95, atau
enterprise SLO/sign-off.

## Checkpoint 24 - Candidate explosion hard limit

Status: `complete (guardrail and regression scope; capacity SLO pending)` -
4 Agustus 2026.

- Engine memakai hard limit default `50.000` raw candidates per topology
  bundle, dengan override eksplisit `config.topology.maxCandidateCount` atau
  `SINERGI_TOPOLOGY_MAX_CANDIDATES`.
- Semua discovery stage memakai budget yang sama. Saat limit terlampaui,
  engine berhenti dengan `topology_candidate_limit_exceeded` (`422`) sebelum
  artifact parsial dikembalikan.
- Diagnostic mencantumkan attempted/max count, stage, dataset version, dan
  site; input geometry tetap tidak berubah.
- Regression test limit `1` terhadap dua endpoint candidate lulus dan
  membuktikan stage `endpoint_device` serta diagnostic lengkap.
- Full backend verification: `156/156` test, lint `85` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/TOPOLOGY-CANDIDATE-LIMIT-2026-08-04.md`.

Batas checkpoint: hard limit ini bukan bukti dense workload, 50.000-object
stress, worker capacity, API p95, atau enterprise SLO.

## Checkpoint 25 - Dead-letter admin API

Status: `complete (JSON durable API contract; PostgreSQL live evidence pending)`
- 4 Agustus 2026.

- API contract test membuat poison job, memindahkannya ke `dead_letter`,
  menampilkan state dan error secara aman, lalu mengulang job ke `queued`.
- Public response tidak mengembalikan payload source; retry mereset attempt dan
  error fields; route tetap Administrator-only pada coverage API.
- Full backend verification: `157/157` test, lint `85` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/DEAD-LETTER-ADMIN-API-2026-08-04.md`.

Batas checkpoint: belum membuktikan PostgreSQL live dead-letter workflow,
retention, alerting/dashboard, atau approval production.

## Checkpoint 26 - Source storage incident handling

Status: `complete (current file-store adapter; external object storage pending)`
- 4 Agustus 2026.

- Existing upload/source-file regression menguji object source hilang dan
  checksum berubah.
- Error actionable yang dipastikan: `source_file_missing` (`404`) dan
  `source_file_integrity_failed` (`409`); path internal tidak bocor dan audit
  incident tercatat.
- Full backend verification: `157/157` test, lint `85` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/SOURCE-STORAGE-INCIDENT-2026-08-04.md`;
  test utama `backend/tests/upload-pipeline.test.js`.

Batas checkpoint: belum membuktikan provider object storage eksternal,
retry/backoff provider, retention, atau alert production.

## Checkpoint 27 - Topology generation timeout

Status: `complete (engine timeout contract; worker/API SLO pending)` -
4 Agustus 2026.

- Engine mempunyai cooperative timeout default `60.000 ms`, dengan override
  `config.topology.maxGenerationMilliseconds` atau
  `SINERGI_TOPOLOGY_MAX_GENERATION_MS`.
- Timeout menghasilkan `topology_generation_timeout` (`504`) dengan diagnostic
  stage, elapsed/limit, candidate count/limit, dataset version, dan site.
- Regression memakai 2.000 path dan timeout `1 ms`; engine fail-closed,
  tidak mengembalikan partial artifact, dan tidak memutasi geometry input.
- Full backend verification: `158/158` test, lint `85` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/TOPOLOGY-GENERATION-TIMEOUT-2026-08-04.md`.

Batas checkpoint: belum membuktikan cancellation worker, cleanup durable
artifact, concurrent API p95, atau production capacity/SLO.

## Checkpoint 28 - Atomic dataset/graph rollback pointer

Status: `complete (JSON/lifecycle/API contract; PostgreSQL live drill pending)`
- 4 Agustus 2026.

- `DatasetVersionLifecycleService.rollbackToPrevious` mengambil previous
  pointer, mengizinkan archived target yang tetap valid, memakai optimistic
  expected-active guard, dan mempublikasikan pointer revision baru.
- Rollback tidak menghapus data; cache invalidation dan audit berada pada
  boundary yang sama. Event sukses `dataset_version.rolled_back` dan failure
  `dataset_version.rollback_failed` dibedakan.
- Route Administrator tersedia di
  `POST /api/admin/datasets/:datasetId/branches/:branchId/rollback`.
- Full backend verification: `160/160` test, lint `86` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/DATASET-ROLLBACK-POINTER-2026-08-04.md`.

Batas checkpoint: PostgreSQL live graph revision rows, backup/restore,
operator drill, dan production approval masih pending.

## Checkpoint 29 - Deterministic topology rerun

Status: `complete (in-process artifact contract; cross-worker persistence
pending)` - 4 Agustus 2026.

- Regression test menjalankan bundle clone dua kali dengan rule-set dan
  `generatedAt` sama, lalu deep-equal seluruh artifact.
- Candidate, relation, graph revision, validation, readiness, dan summary
  terbukti identik pada scope engine in-process.
- Tiga full-suite run berurutan masing-masing `161/161` test lulus; lint `86`
  file, build `37` source file, dan `git diff --check` juga lulus.
- Evidence detail: `docs/migrations/TOPOLOGY-DETERMINISTIC-RERUN-2026-08-04.md`.

Batas checkpoint: belum membuktikan cross-process/instance durable retry,
PostgreSQL persistence, atau stored-artifact deduplication.

## Checkpoint 30 - Deterministic geometry fuzz corpus

Status: `complete (deterministic geometry corpus; adversarial fuzz pending)` -
4 Agustus 2026.

- Corpus menguji antimeridian, koordinat dekat kutub, polyline 2.049 vertex,
  dan empat koordinat out-of-range.
- Valid geometry menghasilkan artifact tanpa validation error/non-finite
  candidate dan tidak memutasi input; invalid bounds fail-closed sebagai
  `path_geometry_ineligible` blocking issue tanpa mutasi input.
- Full backend verification: `162/162` test, lint `87` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/TOPOLOGY-GEOMETRY-FUZZ-2026-08-04.md`.

Batas checkpoint: belum mencakup randomized fuzz campaign, dateline wrapping,
50.000-object stress, atau production geometry distribution.

## Checkpoint 31 - Topology compatibility matrix

Status: `complete (representative family matrix; production vocabulary pending)`
- 4 Agustus 2026.

- Test menguji seluruh 16 pasangan path/node family untuk `cctv`,
  `fiber_optic`, `lan`, dan `infrastructure`.
- Same-family, approved cross-family, dan incompatible-family outcomes
  diverifikasi melalui endpoint candidate output.
- Full backend verification: `163/163` test, lint `88` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/TOPOLOGY-COMPATIBILITY-MATRIX-2026-08-04.md`.

Batas checkpoint: representative type coverage belum menggantikan production
vocabulary/site mapping approval.

## Checkpoint 32 - HTTP correlation ID audit envelope

Status: `complete (request/audit envelope; metrics and full log context pending)`
- 4 Agustus 2026.

- Setiap HTTP response membawa `x-correlation-id`; server menghormati header
  client yang memenuhi format aman atau membuat UUID v4 baru.
- Correlation ID diteruskan ke audit event HTTP untuk authorization denied,
  durable-job action, import accepted/rejected, dan source-file
  download/incident. JSON Lines menyimpan field tervalidasi tanpa mengubah
  sanitasi detail sensitif.
- Regression khusus memverifikasi echo response, UUID generation, dan
  correlation pada audit authorization event.
- Full backend verification: `164/164` test, lint `89` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/HTTP-CORRELATION-ID-2026-08-04.md`;
  test utama `backend/tests/app-correlation-id.test.js`.

Batas checkpoint: dashboard, metrics/alert fault injection, dan correlation
context end-to-end untuk worker/service event serta dataset version/job ID/
graph revision masih pending.

## Checkpoint 33 - Twenty reviewer concurrency

Status: `complete (JSON repository concurrency contract; PostgreSQL/live load pending)`
- 4 Agustus 2026.

- Regression membuat 20 candidate berbeda dan menjalankan 20
  `TopologyService.confirmCandidate` secara bersamaan dengan actor berbeda.
- Semua mutation berhasil; `recordRevision=20`, tepat 20 candidate menjadi
  `confirmed`, dan 20 audit event tercatat.
- Full backend verification: `165/165` test, lint `89` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail: `docs/migrations/TWENTY-REVIEWER-CONCURRENCY-2026-08-04.md`;
  test utama `backend/tests/topology-review-hardening.test.js`.

Batas checkpoint: bukti ini hanya mencakup JSON repository pada satu host.
HTTP load 20 reviewer, PostgreSQL multi-instance, confirm/revoke bersamaan,
dan regeneration/review race masih pending.

## Checkpoint 34 - Confirm/revoke concurrent state machine

Status: `complete (JSON state-machine contract; HTTP/PostgreSQL load pending)`
- 4 Agustus 2026.

- Regression menjalankan revoke relation dan confirm candidate lain secara
  bersamaan setelah satu path attachment confirmed.
- Record lock mencegah lost update; konflik optimistic revision diterima
  sebagai hasil yang dapat dipulihkan dan retry eksplisit dengan snapshot baru.
- Hasil akhir tervalidasi: candidate lama `revoked`, candidate baru
  `confirmed`, satu active path-attachment relation, dan tidak ada device edge
  parsial. Lock JSON juga menangani `EPERM` transient Windows saat release.
- Suite topology-review-hardening lulus tiga kali berturut-turut.
- Full backend verification: `166/166` test, lint `89` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail:
  `docs/migrations/CONFIRM-REVOKE-CONCURRENCY-2026-08-04.md`.

Batas checkpoint: HTTP load, PostgreSQL multi-instance, dan regeneration/review
race masih pending; automatic client retry policy juga belum ditetapkan.

## Checkpoint 35 - Full regeneration/review race

Status: `complete (JSON repository race contract; PostgreSQL/live load pending)`
- 4 Agustus 2026.

- Regression menjalankan full topology regeneration dan confirm candidate
  secara bersamaan pada dataset version yang sama.
- Optimistic revision conflict dipulihkan dengan retry eksplisit memakai
  snapshot terbaru; kedua urutan serialisasi yang sah diuji.
- Hasil akhir tetap memiliki candidate `confirmed`, relation termaterialisasi,
  dan satu topology run; keputusan review tidak hilang.
- Suite topology-review-hardening lulus lima kali berturut-turut.
- Full backend verification: `167/167` test, lint `89` file, build `37` source
  file, dan `git diff --check` lulus.
- Evidence detail:
  `docs/migrations/REGENERATION-REVIEW-RACE-2026-08-04.md`.

Batas checkpoint: HTTP race, PostgreSQL multi-instance, durable worker race,
dan automatic client retry policy masih pending.

## Checkpoint 36 - PostgreSQL live recovery preflight

Status: `preflight complete; live restart/failover not executed`
- 4 Agustus 2026.

- Service Windows `postgresql-x64-18` terdeteksi running dan `pg_isready` pada
  `127.0.0.1:5432` menerima koneksi.
- Tidak ada `SINERGI_DATABASE_URL` atau credential environment PostgreSQL yang
  tersedia pada task.
- Runner dijalankan dan berhenti fail-closed dengan `database_url_required`
  sebelum membuka pool atau me-restart service.
- Evidence detail:
  `docs/migrations/POSTGRES-LIVE-RECOVERY-PREFLIGHT-2026-08-04.md`.

Batas checkpoint: ini bukan bukti live schema, auth, restart, failover,
durability, atau backup/restore. Live drill menunggu kredensial dan otorisasi
operator yang tepat.

## Status berikutnya

Task lokal utama sudah mencakup race reviewer, confirm/revoke, dan
regeneration/review. Live PostgreSQL restart/failover menunggu kredensial dan
otorisasi operator; concurrency/load/SLO dan enterprise approval gates tetap
terpisah.
Setiap checkpoint hanya boleh ditandai selesai
setelah test, lint/build, dan regression evidence lulus; bukti live database
harus dilaporkan terpisah dari test contract. Bukti lokal yang sudah lulus tidak
mengubah status enterprise `NO-GO` sebelum production cutover, recovery,
security, dan approval gates selesai.
