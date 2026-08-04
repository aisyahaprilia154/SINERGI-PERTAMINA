# Dataset version pilot parity evidence

Status: `live verified` — 4 Agustus 2026.

## Input

- Fixture: `backend/tests/fixtures/dataset-version-pilot.json`
- Dataset version: `dv-pilot-parity`
- Fixture SHA-256: `08F1737D1B15E3BA88BB759F055849664F83163DFE8BCA9554CB8844EC14EA4E`
- Source checksum inside fixture: `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

## Expected projection counts

| Entity table | Expected | Contract result |
|---|---:|---:|
| `dataset_versions` | 1 | 1 |
| `source_features` | 3 | 3 |
| `source_geometries` | 3 | 3 |
| `classified_objects` | 3 | 3 |
| `topology_jobs` | 0 | 0 |
| `topology_candidates` | 1 | 1 |
| `confirmed_relations` | 1 | 1 |
| `graph_revisions` | 1 | 1 |
| `graph_nodes` | 2 | 2 |
| `graph_edges` | 1 | 1 |
| `accuracy_evaluations` | 0 | 0 |
| `audit_events` | 0 | 0 |

## Verification

- Migrator: `backend/src/database/pilot-migration.js`.
- Test: `backend/tests/pilot-migration.test.js`.
- Parity check dijalankan di dalam transaksi repository; mismatch menyebabkan
  rollback dan `pilot_parity_failed`.
- Contract test: 25/25 test terarah lulus.

## Live verification

- Migration `0001_operational_schema` applied successfully with checksum
  `5a9a2fa9cd7590ab27f1c65a135b57c6748be7a1c548aea7d572a6449fb3d6be`.
- Migration `0002_dataset_active_pointers` applied successfully with checksum
  `9af8f6e0297652caabb7a70ea80510a996b39b3db92580e4e2ebda89e628358d`.
- Migration `0003_postgres_runtime_state` applied successfully with checksum
  `ae3d4d9ddd9e992d400d2200fa9853859d524913598f1f3fa68ce6c1d63851ad`.
- `npm run db:pilot` executed against the local PostgreSQL 18/PostGIS target.
- All 12 projection counts matched exactly: dataset version `1`, source
  features `3`, source geometries `3`, classified objects `3`, topology jobs
  `0`, candidates `1`, confirmed relations `1`, graph revisions `1`, graph
  nodes `2`, graph edges `1`, accuracy evaluations `0`, and audit events `0`.
- Live result returned `parity.equal: true`.

## Batas evidence

Parity live sudah terbukti pada dataset pilot. Query plan, backup/restore,
shadow compare, primary runtime, dan repository concurrency juga sudah lulus;
production API cutover/recovery dan production-sized load tetap menjadi batas
evidence berikutnya.
