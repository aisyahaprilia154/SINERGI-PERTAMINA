# Live PostgreSQL shadow pilot scope dan fail-closed runner - 5 Agustus 2026

Status: `code complete; live rerun pending operator execution`.

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
lulus. Rerun live tetap harus dijalankan setelah operator mengulangi command
pada database target.

## Gate berikutnya

Operator menjalankan ulang dari `backend`:

```powershell
npm run db:live-verify
```

Checkpoint live baru dapat ditutup bila `db:shadow-pilot` menghasilkan
`equal: true`, seluruh pemeriksaan berikutnya lulus, dan output berakhir pada
`Live verification selesai.`.
