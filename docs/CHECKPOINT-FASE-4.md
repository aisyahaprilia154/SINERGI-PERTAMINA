# Checkpoint Implementasi Fase 4

Tanggal: 2026-08-12  
Branch: `codex/phase-1-5-integration`  
Spesifikasi: [`SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md`](./SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md)

## Status

Implementasi kode dan automated acceptance gate Fase 4: **lulus**. Exit gate
production/pilot: **pending** karena known-path sample, lima skenario failure
pilot yang diverifikasi teknisi, dan sign-off deployment belum tersedia.

## Deliverable yang selesai

- Trace mempertahankan compatibility request lama dan menambahkan mode
  `connectivity`, `point_to_point`, `upstream`, `downstream`, dan `reachable`.
- Physical adjacency selalu memakai confirmed edge dua arah; service adjacency
  hanya memakai `source_to_target`, `target_to_source`, atau `bidirectional`.
  `undirected` tidak dipakai diam-diam untuk directional traversal.
- BFS deterministic memakai urutan `edge_id` lalu target Asset ID, visited set,
  predecessor, dan `maxDepth` 1--10.000. Geometry length bukan routing weight;
  `totalLengthMeters` menjadi `null` bila ada edge tanpa length.
- Negative result canonical tersedia untuk source/target invalid, isolated,
  different component, candidate pending review, direction/root yang belum
  cukup, scope, max depth, dan unreachable. Candidate/rejected/revoked tetap
  tidak masuk confirmed traversal.
- Endpoint `GET /api/dataset-versions/:id/topology/roots` mengembalikan verified
  root/core, role, component, dan direction coverage.
- Endpoint `POST /api/dataset-versions/:id/topology/impact` menjalankan simulasi
  failure asset/relation/path terhadap root reachability, dengan multiple roots,
  cut edges, grouping metadata, dan pemisahan
  `confirmedTopologyImpact`/`potentialTopologyImpact`.
- Direction-incomplete area memakai status `partial` dan reason
  `direction_incomplete`; hasil impact tidak menyatakan perangkat benar-benar
  down atau menggantikan monitoring real-time.
- Trace/impact memiliki cache key yang terikat pada dataset version, graph
  revision, dan normalized request hash. Perubahan graph revision tidak dapat
  memakai cache lama. Audit menyimpan actor, mode/failure, status/reason,
  impact/hop count, correlation ID, cache hit, dan duration tanpa token atau
  geometry penuh; audit failure tidak menggagalkan analisis.
- Viewer trace/impact/roots dibatasi ke active version bila repository lifecycle
  tersedia. Administrator dapat memakai preview eksplisit pada query
  `preview=true`; profile `map_only` tetap unavailable untuk viewer.
- Frontend service menyediakan trace mode/depth, `loadTopologyRoots`, dan
  `analyzeTopologyImpact` tanpa memindahkan graph algorithm ke browser.

## Bukti verifikasi

```text
backend:  npm test -> 224 passed, 0 failed, 0 skipped
backend:  npm run lint -> Syntax lint passed for 107 JavaScript files
frontend: npm test -> 168 passed, 0 failed, 0 skipped
frontend: npm run lint -> Syntax lint passed for 86 frontend JavaScript files
git diff --check -> bersih
```

Synthetic performance gate pada Node v24.15.0 / Windows x64 dengan 50.000 node
dan 100.000 confirmed edge: trace p95 **324.467 ms** (threshold 1.000 ms),
impact p95 **825.748 ms** (threshold 3.000 ms), tanpa violation.

Test tambahan Fase 4 mencakup directional/physical traversal, source=target,
isolated/different component/candidate pending, cycle dan deterministic equal
hop, scope/max-depth, roots, node/relation/path impact, multiple roots,
partial/potential direction, stale revision, cache invalidation, publication
profile, API forwarding, dan audit failure tolerance.

## Gate yang masih pending

- [ ] Known-path sample Fase 3 dijalankan melalui endpoint trace aktif dan
  diverifikasi urutan node/edge/path oleh teknisi.
- [ ] Minimal lima failure scenario pilot diverifikasi teknisi.
- [x] Performance p95 synthetic 50.000 node/100.000 confirmed edge lulus pada
  environment verifikasi saat checkpoint; deployment target tetap perlu
  verifikasi terpisah.
- [ ] Production active-version authorization dan operational-topology profile
  mendapat sign-off deployment.

Automated gate Fase 4: **lulus**. Fase 5 baru boleh dipublikasikan setelah
confirmed graph, trace/impact contract, dan exit gate pilot ini diselesaikan.
