# PostgreSQL Backup/Restore — 5 Agustus 2026

Status: `passed (local temporary clean database; production DR sign-off pending)`.

## Execution

- Command: `npm run db:backup-restore`.
- Backup artifact:
  `backend/artifacts/database-backup/sinergi-live-20260805T034245Z.dump`.
- Backup SHA-256:
  `DF655E6CEBFB8AF6F64985C2D2BDC08CB5E18CFADCC2ACAB6390EAC45B550F59`.
- Restore target: `sinergi_restore_check_761fb3d0`.
- Credential values were entered through secure prompts and are not recorded.

## Parity result

Source and restored database sama-sama melaporkan PostGIS `3.6.2` pada
PostgreSQL `18`. Seluruh projection count yang dilaporkan runner sama:

| Projection | Source | Restored |
|---|---:|---:|
| `dataset_versions` | 8 | 8 |
| `source_features` | 3 | 3 |
| `source_geometries` | 3 | 3 |
| `classified_objects` | 3 | 3 |
| `topology_candidates` | 19 | 19 |
| `confirmed_relations` | 13 | 13 |
| `graph_revisions` | 7 | 7 |
| `graph_nodes` | 14 | 14 |
| `graph_edges` | 7 | 7 |

Runner result: `passed`. Restore target memakai prefix aman
`sinergi_restore_check_`; backup dump tetap di luar Git dan tidak boleh dibagikan
sebagai evidence publik karena dapat berisi data database.

## Batas bukti

Ini membuktikan backup/restore lokal dan parity projection pada satu environment.
Ini belum membuktikan backup retention, off-site copy, encryption/key rotation,
point-in-time recovery, production disaster-recovery RTO/RPO, atau sign-off
Operations/Security.
