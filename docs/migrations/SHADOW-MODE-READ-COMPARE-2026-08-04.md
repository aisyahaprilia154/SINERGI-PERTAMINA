# Shadow mode read/compare — 4 Agustus 2026

Status: `complete (contract + local live pilot)`.

## Scope

Shadow mode menjaga repository utama sebagai satu-satunya source of truth
aplikasi. Repository bayangan hanya dibaca untuk dibandingkan; hasil bayangan
tidak pernah dipakai untuk publication, activation, tracing, atau keputusan
state.

Implementasi:

- Repository decorator: `backend/src/storage/shadow-dataset-version-repository.js`.
- Test contract: `backend/tests/shadow-dataset-version-repository.test.js`.
- Read yang dibandingkan: `get`, `list`, `findActive`, dan
  `resolveActiveVersion`.
- Perbandingan memakai fingerprint SHA-256 deterministik per section aggregate;
  urutan row database dinormalisasi berdasarkan identity entity.
- Mismatch mencakup candidate, confirmed relation, graph node/edge/component,
  unresolved, pointer active, record yang hilang/ekstra, dan duplicate ID.
- Report tidak membawa payload sumber; hanya status availability, fingerprint,
  count, section, dan error code yang aman untuk diagnosa.
- Read shadow gagal secara fail-open terhadap hasil primary tetapi tetap menjadi
  report mismatch.
- `create`, `update`, dan `activateVersionAtomically` hanya didelegasikan ke
  repository primary. Test membuktikan shadow write count tetap `0`.
- Report disimpan dengan batas retention dan dapat dikirim ke reporter untuk
  metrics/audit tanpa mengubah publication boundary.
- Live pilot command: `npm run db:shadow-pilot`. Command ini membuat primary
  JSON sementara dari fixture pilot, membaca PostgreSQL sebagai shadow, dan
  membandingkan `get`, `list`, `findActive`, serta `resolveActiveVersion`.

## Verification evidence

- `node --test tests/shadow-dataset-version-repository.test.js`: 5/5 lulus.
- `npm test`: 129/129 lulus.
- `npm run lint`: 68 file lulus.
- `npm run build`: 33 source file lulus.

## Live verification

`npm run db:shadow-pilot` lulus terhadap PostgreSQL 18/PostGIS `3.6.2`.
Keempat read comparison (`get`, `list`, `findActive`, dan
`resolveActiveVersion`) menghasilkan `equal: true`; fingerprint `get` pada
primary JSON dan shadow PostgreSQL sama, dan command tidak melakukan shadow
write maupun publication.

## Remaining boundary

- Production deployment must set `SINERGI_STORAGE_MODE=postgres` (or provide
  `SINERGI_DATABASE_URL` without an override) and complete HTTP E2E smoke tests.
- Restart/recovery, production-sized load/concurrency, dan SLO evidence.
- Publication/canary sign-off.

Checkpoint ini membuktikan kontrak, fail-safe behavior, dan read parity pada
pilot lokal; belum membuktikan production cutover atau enterprise readiness.
