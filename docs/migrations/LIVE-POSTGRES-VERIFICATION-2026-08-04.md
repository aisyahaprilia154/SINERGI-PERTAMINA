# Live PostgreSQL/PostGIS verification matrix — 4 Agustus 2026

Scope: local PostgreSQL 18 on `127.0.0.1:5432`, database `sinergi`.

## Current evidence

| Check | Status | Evidence |
|---|---|---|
| PostgreSQL service/listener | `passed` | Service `postgresql-x64-18` running; `pg_isready` accepted connection. |
| SCRAM admin/app credentials | `passed` | `psql` authenticated as `postgres`; pilot commands authenticated with application URL. |
| PostGIS installation/activation | `passed` | PostGIS control file present; migration verification succeeded; pilot geometry rows inserted. |
| Migration `0001` | `passed` | Applied live; checksum `5a9a2fa9cd7590ab27f1c65a135b57c6748be7a1c548aea7d572a6449fb3d6be`. |
| Migration `0002` | `passed` | Applied live; checksum `9af8f6e0297652caabb7a70ea80510a996b39b3db92580e4e2ebda89e628358d`. |
| Migration `0003` | `passed` | Applied live; checksum `ae3d4d9ddd9e992d400d2200fa9853859d524913598f1f3fa68ce6c1d63851ad`. |
| Pilot projection parity | `passed` | All 12 counts equal; `parity.equal: true`; see [pilot evidence](DATASET-VERSION-PILOT-PARITY-2026-08-04.md). |
| PostgreSQL primary runtime | `passed` | `db:primary-pilot` selected `PostgresDatasetVersionRepository`, wrote/updated an aggregate, and completed a PostgreSQL durable job with `jsonPrimaryUsed: false`. |
| Shadow read/compare | `passed` | `db:shadow-pilot` exit `0`; four comparisons equal, no shadow write/publication. |
| PostgreSQL optimistic concurrency | `passed` | `db:concurrency` exit `0`; one success, one stale-revision conflict, no unexpected failure. |
| Index/query plan | `passed (pilot-sized)` | Required indexes present; geometry, candidate, and graph bbox plans used index scans. |
| Backup/restore | `passed (local pilot)` | Custom-format dump restored into a generated temporary database; counts and PostGIS matched. |

## Pilot parity counts

| Projection | Count |
|---|---:|
| `dataset_versions` | 1 |
| `source_features` | 3 |
| `source_geometries` | 3 |
| `classified_objects` | 3 |
| `topology_jobs` | 0 |
| `topology_candidates` | 1 |
| `confirmed_relations` | 1 |
| `graph_revisions` | 1 |
| `graph_nodes` | 2 |
| `graph_edges` | 1 |
| `accuracy_evaluations` | 0 |
| `audit_events` | 0 |

## Live execution evidence

All checks below ran against local PostgreSQL 18 on `127.0.0.1:5432` with
PostGIS `3.6.2`. Password values were not stored in the repository.

- `npm run db:shadow-pilot`: `comparisonCount: 4`, every report had
  `equal: true`; the `get` fingerprints were identical at
  `sha256:9cae187c042ac97c5e324e56514971695dca47a4afcdd68550a808822ae95f27`.
  The command performed no shadow write and no publication.
- `npm run db:primary-pilot`: runtime mode was `postgres`; the repository class
  was `PostgresDatasetVersionRepository`; aggregate create/update and durable
  job claim/complete succeeded; all generated rows were cleaned up.
- `npm run db:concurrency`: one update succeeded, one update returned
  `dataset_version_stale_revision`, and the generated temporary row was
  cleaned up. Final `recordRevision` was `1`.
- `npm run db:query-plan`: all required indexes were present. The live pilot
  plans used `source_geometries_geometry_gist_idx`,
  `topology_candidates_source_endpoint_idx`, and
  `graph_nodes_location_gist_idx`. The script keeps the caveat that
  production-sized EXPLAIN evidence is still required for SLO claims.
- Backup/restore: `pg_dump` and `pg_restore` completed successfully into
  `sinergi_restore_check_e75e0be5`; source and restored counts matched and
  PostGIS was `3.6.2`. Backup SHA-256:
  `D63B33CE5F512F77BD3441B4FB1F0A8F0C0452CA8F27FD5E721BEC6BA938FAEA`.
  The temporary restore database was deleted after verification.
- `pg_hba.conf` was restored to its original SHA-256
  `0C8DC6E6E57399790417A6E13B3A8E1B5E27AA19708A2122148FBFE3BDCECD42`;
  localhost authentication is again `scram-sha-256`.

## Still not proven for enterprise GO

- The production server uses PostgreSQL as source of truth when
  `SINERGI_STORAGE_MODE=postgres` (or when `SINERGI_DATABASE_URL` is present
  without a mode override). Live HTTP review replay passed on a pilot fixture;
  production-sized HTTP replay remains pending.
- Review state, relation, graph revision, and audit event are PostgreSQL-backed;
  transaction coupling now has runtime/contract, HTTP fault-injection, and
  live pilot concurrency evidence.
- Durable jobs are PostgreSQL-backed and the primary pilot passed; restart/
  recovery under process failure, retry idempotency across instances,
  20-reviewer load, and representative 10,000/50,000-object SLO evidence
  remain pending.
- Accuracy gold set, SSO/RBAC, security review, operational runbook,
  observability sign-off, canary, and organization approvals are external
  gates, not solvable by local database credentials alone.
