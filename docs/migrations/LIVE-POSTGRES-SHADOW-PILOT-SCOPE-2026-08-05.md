# Live PostgreSQL shadow pilot scope dan fail-closed runner - 5 Agustus 2026

Status: `passed (local PostgreSQL live pilot; enterprise gates pending)`.

## Temuan dari rerun

`npm run db:live-verify` menyelesaikan primary pilot, concurrency, dan query
plan, tetapi `db:shadow-pilot` menghasilkan `equal: false` pada operasi
`list`. Perbedaannya hanya berupa `record_extra_in_shadow` untuk tujuh
dataset-version probe historis:

- satu `live-concurrency-*`;
- dua `live-db-disconnect-*`;
- empat `live-http-review-*`.

Dataset disconnect dan HTTP review memang dipertahankan ketika memiliki audit
event karena `audit_events` append-only. Row tersebut tidak boleh dihapus
untuk memaksa parity.

## Perubahan

- `database-shadow-pilot.mjs` sekarang membatasi perbandingan `list` shadow
  pada dataset-version fixture `dv-pilot-parity`, karena primary JSON
  sementara memang hanya memuat fixture tersebut.
- `get`, `findActive`, dan `resolveActiveVersion` tetap dibandingkan terhadap
  repository PostgreSQL tanpa mengubah scope dataset atau active pointer.
- Runner mencetak report mismatch lalu keluar non-zero dengan kode
  `shadow_pilot_parity_mismatch` jika `equal` bukan `true`. Wrapper
  `db:live-verify` tidak lagi dapat menyatakan selesai ketika shadow parity
  gagal.
- Perubahan ini read-only terhadap PostgreSQL; tidak ada shadow write,
  publication, atau penghapusan audit event.

## Verification

Contract test untuk scoping dan fail-closed assertion ditambahkan pada
`backend/tests/database-shadow-pilot.test.js`. Setelah perubahan, backend
`173/173` test, lint `91` file, build `37` source file, dan `git diff --check`
lulus.

Rerun live pada 5 Agustus 2026 pukul 04:33 UTC lulus:

- PostgreSQL 18/PostGIS `3.6.2`; seluruh 13 tabel operasional tersedia.
- Shadow `comparisonCount=4`, `equal=true`; `get`, scoped `list`,
  `findActive`, dan `resolveActiveVersion` semuanya equal, tanpa shadow write
  atau publication.
- Primary pilot memakai `PostgresDatasetVersionRepository`, durable job
  `succeeded`, `jobRevision=2`, dan `jsonPrimaryUsed=false`.
- Concurrency menghasilkan tepat satu success dan satu stale conflict, nol
  unexpected failure, serta `finalRecordRevision=1`.
- Tujuh required indexes hadir. Geometry bbox dan graph location memakai
  index scan; candidate query pada tabel pilot kecil masih boleh memakai
  sequential scan. Production-sized EXPLAIN/SLO tetap pending.
- Wrapper mencapai `Live verification selesai.`

## Gate berikutnya untuk enterprise

Tidak ada tindakan manual tambahan untuk checkpoint live lokal ini. Failover
production, load/concurrency production-sized, SLO, DR retention/off-site,
security review, dan organizational sign-off tetap merupakan gate enterprise
terpisah.
