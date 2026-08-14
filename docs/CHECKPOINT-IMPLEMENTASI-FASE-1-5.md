# Checkpoint Implementasi Fase 1–5

Tanggal checkpoint: 2026-08-12

Repository: `SINERGI-PERTAMINA`

Spesifikasi acuan: [`docs/SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md`](./SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md)

## Status ringkas

Fase 1–4 sudah diimplementasikan dan lulus automated gate masing-masing.
Exit gate pilot Fase 2–4 tetap pending; Fase 5 belum dieksekusi. Detail
checkpoint ada di [`docs/CHECKPOINT-FASE-2.md`](./CHECKPOINT-FASE-2.md),
[`docs/CHECKPOINT-FASE-3.md`](./CHECKPOINT-FASE-3.md), dan
[`docs/CHECKPOINT-FASE-4.md`](./CHECKPOINT-FASE-4.md).

> Status Fase 2 pada paragraf legacy di atas telah disupersede oleh checkpoint
> khusus [`CHECKPOINT-FASE-2.md`](./CHECKPOINT-FASE-2.md): automated gate lulus,
> sedangkan pilot/usability gate masih pending.

| Fase | Status | Bukti / dependency berikutnya |
|---|---|---|
| Fase 1 — Dataset benar dan dapat dipercaya | **Implemented + verified** | Kontrak readiness v2, parser evidence, identity registry, diff/risk, preview/activation/rollback, migration, dan test suite lulus. Pilot source production tetap perlu sign-off sebelum menyatakan exit gate operasional final. |
| Fase 2 — Peta operasional minimum | **Implemented + verified; pilot pending** | Automated gate lulus; usability/source baseline dan sign-off pilot masih diperlukan. |
| Fase 3 — Pembangunan dan verifikasi topologi | **Implemented + verified; pilot pending** | Automated gate lulus; known-path verification dan operational-topology publication masih diperlukan. |
| Fase 4 — Tracing dan analisis dampak | **Implemented + verified; pilot pending** | Automated gate dan synthetic performance lulus; known-path, lima failure scenario teknisi, deployment-target verification, dan publication sign-off masih diperlukan. |
| Fase 5 — Diagram topologi cabang | **Pending** | Bergantung pada graph/revision dan trace/impact Fase 3–4. |

> Current Fase 2 checkpoint: **Implemented + verified; pilot pending**. Lihat
> [`docs/CHECKPOINT-FASE-2.md`](./CHECKPOINT-FASE-2.md) untuk deliverable dan
> bukti automated acceptance terbaru. Current Fase 3 checkpoint: lihat
> [`CHECKPOINT-FASE-3.md`](./CHECKPOINT-FASE-3.md). Current Fase 4 checkpoint:
> lihat [`CHECKPOINT-FASE-4.md`](./CHECKPOINT-FASE-4.md).

## Checkpoint Fase 1

### F1-01 sampai F1-05 — Source, evidence, classification, identity, metadata

- [x] Package safety dan immutable source boundary tetap berlaku untuk KML/KMZ.
- [x] Parser menyimpan source feature, geometry, overlay, style/resource, dan
  coverage reconciliation; unsupported evidence menghasilkan issue, bukan
  silent skip.
- [x] Classification menyimpan object role, network family, source status,
  canonical category/asset type, asset name, dan source provenance.
- [x] Stable identity mendukung explicit identity, exact source KML identity,
  registry lintas versi, conflict detection, dan onboarding candidate.
- [x] Operational object memakai metadata minimum `asset_id`, `asset_name`,
  canonical type/category, `site_id`, dan `source_status` sesuai gate profile.
- [x] Identity assignment batch tersedia dengan alasan, expected revision,
  idempotency key, audit event, dan replay-safe response.

### F1-06 sampai F1-08 — Readiness, issue, dan comparison

- [x] Readiness contract tunggal memakai schema `2.0.0` dan policy
  `publication-policy:1`.
- [x] `map_only` dipisahkan dari `operational_topology`; frontend memakai
  capability hasil backend dan tidak menghitung ulang publishability.
- [x] Issue contract membawa dimension, blocking profiles, severity,
  recommended action, dan kemampuan publish/activate per profile.
- [x] Dataset diff mencakup penambahan/penghapusan, identity change, metadata,
  classification, site, geometry, overlay, relation, dan onboarding mismatch.
- [x] Diff memiliki risk level, summary, deterministic revision, serta cursor
  pagination yang terikat pada comparison revision.
- [x] High-risk activation memerlukan `confirmBreakingChanges=true`.

### F1-09 sampai F1-10 — Preview, activation, rejection, rollback

- [x] Preview admin bersifat unpublished/read-only dan mengekspos readiness,
  publishable profiles, comparison, dan link source/validation.
- [x] Activation menerima publication profile, expected record revision,
  expected active-pointer revision, dan mengembalikan audit event.
- [x] Activation memakai atomic pointer semantics; stale revision ditolak.
- [x] Rejection menyimpan reason/archive reason dan audit mutation contract.
- [x] Rollback mengaktifkan version sebelumnya melalui jalur atomic yang sama,
  dengan profile dan audit trail.
- [x] JSON repository dan PostgreSQL adapter sama-sama memiliki persistence
  untuk publication profile, identity registry, dan dataset diff projection.

### Migration dan API

- [x] Migration `0004_phase_one_publication_identity_diff` menambah publication
  profile, `asset_identity_registry`, dan `dataset_version_diffs`, termasuk
  down migration.
- [x] Runtime schema verification mengenali tabel projection Fase 1.
- [x] Endpoint comparison tersedia dengan risk/type filter dan pagination.
- [x] Endpoint identity assignment tersedia di bawah authorization Administrator.
- [x] Upload mendeteksi duplicate source checksum dalam dataset/branch yang sama
  dan mempertahankan source version lama sebagai immutable.

### Bukti verifikasi Fase 1

Perintah dijalankan dari workspace pada checkpoint ini:

```text
backend:  npm run lint  -> Syntax lint passed for 102 JavaScript files
backend:  npm test      -> 203 passed, 0 failed, 0 skipped
frontend: npm run lint  -> Syntax lint passed for 86 frontend JavaScript files
frontend: npm test      -> 165 passed, 0 failed, 0 skipped
git diff --check        -> bersih
```

Test fungsional tambahan Fase 1 mencakup readiness map-only vs operational,
exact source KML identity vs onboarding, high-risk diff/pagination, JSON
activation confirmation, dan migration contract.

### Keputusan exit gate Fase 1

Implementasi kode dan automated acceptance gate Fase 1: **lulus**. Status exit
gate production/pilot: **menunggu pilot source baseline dan sign-off deployment**.
Dokumen ini tidak menganggap fixture test sebagai pengganti verifikasi pilot
source yang diwajibkan spesifikasi.

## Checkpoint Fase 2 — Implemented + verified; pilot pending

Fase 2 telah dieksekusi dan automated acceptance gate lulus. Scope pilot
berikut masih menjadi gate operasional yang harus dibuktikan:

- [ ] active dataset resolution, branch/site/area scope, dan provenance.
- [ ] geographic map projection dan overlay resource yang dapat direkonsiliasi.
- [ ] server-side search, filter/facet/cursor, dan asset detail.
- [ ] shareable URL state, version switch handling, dan filtered KML export.
- [ ] usability study pilot: minimal 90% peserta menemukan target tanpa bantuan.
- [ ] median waktu menemukan aset minimal 30% lebih cepat dari baseline.
- [ ] seluruh test dan performance gate Fase 2 lulus.

Detail deliverable dan bukti terbaru ada di
[`CHECKPOINT-FASE-2.md`](./CHECKPOINT-FASE-2.md). Pilot source baseline,
usability, dan sign-off deployment tetap diperlukan.

## Checkpoint Fase 3 — Implemented + verified; pilot pending

Fase 3 telah dieksekusi dan automated acceptance gate lulus. Deliverable,
bukti test/lint, serta batasan exit gate pilot ada di
[`CHECKPOINT-FASE-3.md`](./CHECKPOINT-FASE-3.md). Known-path verification,
source baseline, dan operational-topology publication tetap menunggu pilot.

## Checkpoint Fase 4 — Implemented + verified; pilot pending

Fase 4 telah dieksekusi dan automated acceptance gate lulus. Trace modes,
directional BFS, negative taxonomy, roots, impact simulation, audit/cache,
active-version boundary, API, dan frontend client contract tersedia. Detail
deliverable serta bukti terbaru ada di
[`CHECKPOINT-FASE-4.md`](./CHECKPOINT-FASE-4.md).

- Known-path sample, minimal lima failure scenario pilot yang diverifikasi
  teknisi, deployment-target verification, dan sign-off deployment tetap
  menjadi exit gate operasional. Synthetic performance 50.000 node/100.000
  edge sudah lulus pada environment verifikasi checkpoint.


## Checkpoint Fase 5 — Pending

Fase 5 belum dieksekusi pada checkpoint ini. Scope berikut menjadi gate yang
harus dibuktikan:

- [ ] diagram memakai dataset version dan graph revision yang sama dengan map
  serta trace.
- [ ] scope graph, hierarchy/component fallback, grouping, dan progressive
  loading benar.
- [ ] selection map/diagram konsisten melalui stable Asset ID.
- [ ] trace/impact/candidate review projection konsisten.
- [ ] layout cache, worker timeout, failure fallback, export SVG/PNG, dan
  metadata version/revision/profile.
- [ ] functional, consistency, performance, serta hero workflow E2E lulus.

Checkpoint Fase 5 bergantung pada graph/revision Fase 3–4. Tidak ada perubahan
Fase 5 yang dijalankan dalam task ini.

> **Status superseding 2026-08-12:** Fase 1, Fase 2, Fase 3, dan Fase 4 telah
> diimplementasikan dan lulus automated acceptance gate. Exit gate
> production/pilot Fase 2 masih menunggu usability/source baseline; Fase 3
> masih menunggu known-path verification dan operational-topology publication;
> Fase 4 masih menunggu known-path, lima failure scenario teknisi,
> deployment-target verification, dan deployment sign-off.
> Detail: [`CHECKPOINT-FASE-2.md`](./CHECKPOINT-FASE-2.md),
> [`CHECKPOINT-FASE-3.md`](./CHECKPOINT-FASE-3.md), dan
> [`CHECKPOINT-FASE-4.md`](./CHECKPOINT-FASE-4.md). Fase 5 belum dieksekusi.

## Aturan checkpoint berikutnya

Setiap fase berikutnya harus memperbarui dokumen ini dengan:

1. perubahan kode dan migration yang benar-benar dibuat;
2. test/performance/acceptance evidence dengan jumlah pass/fail/skip;
3. keputusan exit gate: lulus, pending pilot, atau blocked beserta alasan;
4. dependency yang dibuka untuk fase berikutnya.

Fase berikutnya tidak boleh ditandai selesai hanya karena unit test lulus jika
exit gate pilot, performance, provenance, atau deployment target belum memiliki
bukti.
