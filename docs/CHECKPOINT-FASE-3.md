# Checkpoint Implementasi Fase 3

Tanggal: 2026-08-12
Branch: `codex/phase-1-5-integration`
Spesifikasi: [`SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md`](./SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md)

## Status

Implementasi kode dan automated acceptance gate Fase 3: **lulus**. Exit gate
production/pilot: **pending** karena known-path verification, topology-required
site pilot, source baseline, dan sign-off deployment belum tersedia.

## Deliverable yang selesai

- Topology input bundle meneruskan `sourceStatus`, `topologyRequired`,
  `topologyRole`, dan approved topology exception tanpa mengubah source geometry.
- Eligibility engine fail-closed untuk stable identity yang hilang, identity
  conflict/onboarding, object retired, site/family yang tidak tersedia, dan
  geometry invalid; issue tetap dipertahankan sebagai evidence.
- Candidate engine mempertahankan evidence/score breakdown, default spatial
  inference tetap `candidate`/`ambiguous`, dan graph hanya membaca relation
  `confirmed`.
- Review queue backend mendukung filter status/site/family/type/proposal,
  score range, distance range, asset search, `requiredTopologyOnly`, serta
  cursor yang terikat pada graph/candidate revision dan seluruh filter.
- Endpoint Administrator `POST /api/dataset-versions/:id/topology/review-preview`
  menjalankan dry-run batch, menghitung perubahan component/relation, mendeteksi
  endpoint conflict, dan mengembalikan `safeToApply`.
- Bulk confirm/confirm-selected/line-label sekarang melewati safe preview;
  selected bulk hanya menerima candidate `recommended`, atomik, idempotent,
  reason wajib, dan tetap memakai optimistic revision.
- Manual relation memakai candidate type `manual_relation`, menerima
  `relationKind`, `pathAssetIds`, `sourceGeometryIds`, dan `evidenceRefs`,
  memvalidasi referensi dalam version/site yang sama, serta mempertahankan
  evidence saat regeneration.
- Readiness menghitung node/path yang `topologyRequired`, unresolved endpoint,
  ambiguous required item, dan approved exception secara terpisah.
- Regeneration tidak membawa review lama jika candidate type, site/family,
  rule set, identity, atau relevant geometry fingerprint berubah; keputusan yang
  dibuka ulang masuk candidate history.
- Frontend topology review memanggil review preview sebelum selected bulk
  confirmation dan client contract membawa filter queue Fase 3.

## Bukti verifikasi

```text
backend:  npm.cmd test -> 217 passed, 0 failed, 0 skipped
backend:  npm.cmd run lint -> Syntax lint passed for 105 JavaScript files
frontend: npm.cmd test -> 166 passed, 0 failed, 0 skipped
frontend: npm.cmd run lint -> Syntax lint passed for 86 frontend JavaScript files
git diff --check -> bersih
```

Test tambahan mencakup required topology readiness, geometry-change review
reopen, manual relation evidence/preservation, review-preview API, endpoint
conflict safe gate, filter queue lengkap, dan selected bulk preview.

## Keputusan gate

Automated Fase 3 gate: **lulus**. Publication profile
`operational_topology` dan exit gate pilot tetap **pending** sampai seluruh
known path sample diverifikasi, false component merge pada sample = 0, dan
topology readiness site pilot benar-benar `ready` melalui lifecycle publication.
