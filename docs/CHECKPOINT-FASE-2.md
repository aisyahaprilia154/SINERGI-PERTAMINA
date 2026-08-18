# Checkpoint Implementasi Fase 2

Tanggal: 2026-08-12
Branch: `codex/phase-1-5-integration`
Spesifikasi: [`SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md`](./SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md)

## Status

Implementasi kode dan automated acceptance gate Fase 2: **lulus**. Exit gate
production/pilot: **pending** karena usability study, baseline source pilot,
dan sign-off deployment belum tersedia.

## Deliverable yang selesai

- Active dataset resolution memakai active pointer, branch scope, dan kontrak
  error `active_dataset_not_found`, `active_dataset_integrity_error`, serta
  `forbidden_branch`.
- Active context memuat dataset/version/branch/site, publication profile,
  pointer revision, readiness, summary, dan capabilities. `map_only` tidak
  mengklaim tracing atau impact.
- Site projection menghitung extent dari geometry valid, memakai approved
  boundary bila tersedia, dan melaporkan geometry di luar extent.
- Map projection mempertahankan Point, LineString, Polygon, MultiGeometry, dan
  overlay resource yang valid/resolved tanpa mengganti canonical geometry.
- Search/filter server-side tersedia melalui `GET /api/datasets/:id/active/assets`
  dengan NFKC, ranking stable ID, AND/OR filter, facet, geographic bounds,
  cursor revision-bound, serta pagination maksimal 200 item.
- Detail asset menyediakan provenance, identity, geometry references, field
  availability, confirmed direct connections, capability, dan candidate count
  Administrator-only. Hostname/IP mengikuti authorization.
- URL state menyimpan dataset/branch/site, selected stable asset ID, dan filter
  yang aman; token, IP, raw metadata, geometry, candidate, serta trace payload
  tidak disimpan.
- `POST /api/datasets/:id/active/exports/kml` menghasilkan filtered KML
  server-side dengan metadata version/timestamp/filter, canonical geometry,
  stable Asset ID ExtendedData, dan filename yang disanitasi. Candidate tidak
  ikut diekspor.

## Bukti verifikasi

```text
backend:  npm.cmd run lint -- --no-warn-ignored -> 105 JavaScript files
backend:  npm.cmd test                     -> 210 passed, 0 failed, 0 skipped
frontend: npm.cmd run lint                  -> 86 JavaScript files
frontend: npm.cmd test                      -> 165 passed, 0 failed, 0 skipped
git diff --check                            -> bersih sebelum staging
```

Test tambahan ada di
[`backend/tests/phase-two-functional.test.js`](../backend/tests/phase-two-functional.test.js).
Test tersebut mencakup ranking, filter/facet, visual-only guard, cursor stale,
site extent, map-only capability, MultiGeometry canonical projection, HTTP
branch authorization, active map/detail, filtered KML, dan reference fixture
2.000 asset. Automated performance guard: catalog build < 2 detik dan search
p95 < 500 ms pada fixture tersebut.

## Keputusan gate

Kode Fase 2 boleh menjadi dependency Fase 3 setelah commit/push checkpoint
ini. Status pilot tetap pending; automated fixture bukan pengganti usability
study atau verifikasi source production.
