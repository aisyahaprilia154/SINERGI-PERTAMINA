# Tahap 6 — Versi database React

Tanggal: 23 Oktober 2026. Branch lokal: `react-migration-baseline`.
Checkpoint sebelum tahap: `dcc1d22`. Tidak ada push, merge, atau deployment.

## Implementasi

`/admin/datasets/versions` dan trailing slash kini memakai `VersionsRoute` dengan ThemeProvider, SessionProvider, SessionGate Administrator, AdminLayout/AppHeader, DataTable, dan Dialog React. Halaman tidak memanggil renderer/binder versi lama. Navigasi antarrute masih berupa pemuatan dokumen penuh.

`useDatasetConfig` memuat daftar dataset dengan prioritas yang sama: `datasetId` URL, dataset dari session storage/default, lalu dataset pertama jika ID yang diminta tidak tersedia. Satu dataset ditampilkan sebagai label; beberapa dataset memakai select. Pergantian pilihan tidak menulis ulang URL atau storage, sesuai baseline. Config kosong/error mempunyai status dan tombol retry; retry eksplisit juga tersedia untuk kegagalan daftar versi.

`VersionsPanel` dan `VersionDialog` merender daftar versi, indikator Aktif, jumlah aset/koneksi, label 10 versi maksimum, form simpan, konfirmasi pemulihan, serta status proses/hasil. Tombol pulihkan versi aktif tetap nonaktif. Pengguna harus mengonfirmasi pemulihan; pesan tentang snapshot otomatis dan akun/audit dipertahankan. Nama versi memiliki validasi required, trim dan batas 180 karakter. Submit berulang ditolak sebelum render berikutnya; form, pemilihan dataset, dan Escape/backdrop terkunci saat operasi tulis berlangsung.

Dialog menyimpan snapshot dataset, versi dan `expectedRevision` saat dibuka. Refresh karena focus/storage tidak mengganti snapshot itu. Kegagalan biasa mempertahankan nama form dan snapshot agar pengguna dapat mencoba lagi; konflik 409 menutup dialog, mempertahankan pesan konflik di halaman, dan memuat revision terbaru. Membuka dialog lagi memakai revision terbaru. Respons `existing` dikenali sebagai checkpoint yang sudah tersimpan. Setelah save/restore, daftar dan versi aktif dimuat kembali tanpa membongkar header. Fokus kembali setelah React mengaktifkan tombol; jika tombol versi yang dipulihkan kini disabled, fokus jatuh ke Simpan versi.

`useDatasetVersions` memiliki owner request/listener per dataset. Pergantian dataset membongkar panel lama, menutup dialog, membatalkan read/write lama, serta melepas listener focus/storage/pagehide. Refresh hanya mendengarkan kunci revision dataset yang dipilih, mengabaikan refresh ketika sedang menulis, dan membatalkan read sebelumnya. StrictMode cleanup, pagehide, dan unmount mencegah respons usang mengganti state. Respons 401/403 menghentikan pekerjaan, menghapus sesi lokal, dan mengalihkan ke login. Tidak ada polling/timer/worker baru pada halaman ini.

## Kontrak dan penyesuaian bersama

- `GET /api/import-config`, `GET /api/datasets/:id/versions` tetap sama.
- Save: `POST /api/datasets/:id/versions`, body `{ name, expectedRevision }`.
- Restore: `POST /api/datasets/:id/versions/:versionId/restore`, body `{ expectedRevision }`.
- Token, role, `currentVersionId`, format response, URL, serta `sinergi:revision:<datasetId>` tetap.
- Service versi mendapat parameter options/signal opsional yang kompatibel dengan pemanggilan lama; endpoint dan payload tidak berubah.
- `requestJson` memeriksa signal setelah response JSON selesai, sebelum menangani status atau menulis revision ke localStorage. Ini mencegah response mutasi yang terlambat memublikasikan revision setelah owner dibongkar. Tes mencakup respons berhasil yang tiba setelah abort.
- Overlay mendapat opsi heading di dalam konten, labelledBy, dan className; nilai default tetap seperti tahap 4. Dialog versi menaruh heading di form dan mempertahankan scope CSS lama melalui portal. Shared focus trap/inert/scroll tetap digunakan; CSS aplikasi tidak diubah.
- Tidak ada dependency, backend, skema database, build script atau konfigurasi deployment yang diubah.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Tes Node frontend lama | 336 lulus, 0 gagal |
| Vitest/React Testing Library | 73 lulus, termasuk 18 kasus versi/config baru |
| Tes backend | 75 lulus, 1 integrasi PostgreSQL dilewati karena `SINERGI_TEST_DATABASE_URL` belum tersedia |
| Playwright | 34/34 lulus dalam satu run, termasuk 8 tes versi baru dan 26 regresi auth/fondasi/komponen bersama/pengguna |
| Smoke baseline | 10 kelompok lulus; tanpa uncaught page error atau endpoint tak dikenal; [hasil](stage-6/smoke-results.json) |
| Lint root/frontend/backend | Berhasil, termasuk ESLint JSX dan React Hooks |
| Build frontend/backend | Berhasil; output `dist/client`, worker `dist/server`, manifest backend tetap; fixture e2e tidak masuk build |
| Capture visual | 32 screenshot, 4 keadaan × 4 mode × legacy/React |
| Perbandingan visual | 20/20 pasangan identik, 0 pixel berbeda; 4 daftar juga dibandingkan dengan baseline tahap 1 |

Keadaan visual: daftar aktif, dialog simpan, dialog pulihkan, dan daftar kosong. Ukuran desktop 1440×900/mobile 390×844, terang/gelap. Referensi lama diambil melalui intersepsi entrypoint di browser capture, menggunakan source legacy yang tidak diubah dan fixture API yang sama. Font asli dimuat. Contact sheet diperiksa secara visual. Artefak: [stage-6/](stage-6/), [perbandingan](stage-6/visual-comparison.json), [contact sheet](stage-6/contact-sheet.jpg). Skrip reproduksi: `capture-versions.cjs` dan `compare-versions.py`, dengan Vite aktif, NODE_PATH frontend/node_modules dan Python/Pillow.

Tes meliputi prioritas URL/storage/default dataset, dataset tunggal/beragam/kosong, error config/retry, empty/active checkpoint, validasi native/trim, payload dan Bearer token, deduplikasi submit, status existing, snapshot revision, konflik dan retry, konfirmasi restore, busy/dismissal, fokus, data stale setelah switch, scope event storage, listener tanpa duplikasi, abort pada unmount/pagehide, revision storage setelah abort, penolakan sesi dan Viewer sebelum data admin dimuat. Tes Node lama tetap memakai renderer lama, sehingga regresi service bersama juga diperiksa.

Kegagalan awal fokus setelah mutasi diperbaiki dengan pengembalian fokus pada layout effect sesudah commit state loading/busy. Penghitungan write pada fixture browser diperbaiki agar hanya menghitung endpoint dataset dan tidak memasukkan heartbeat POST. Tidak ada assertion yang dihapus/dilemahkan atau timeout yang dinaikkan.

## Batas verifikasi dan kelanjutan

Seluruh operasi tulis UI memakai API mock. Login akun lama, PostgreSQL/PostGIS nyata, backup/restore database asli, dan Docker deployment belum diverifikasi. Tidak ada data, akun, aset atau file upload operasional yang diubah. Abort client mencegah efek response di UI/storage; bukan jaminan pembatalan transaksi yang sudah diterima server. Peringatan ukuran bundle MapLibre sudah ada sebelumnya.

Tiga halaman aktif React: login, Kelola pengguna, Versi database. Empat halaman lain masih legacy: riwayat/unggah, preview impor, peta dan topologi. Renderer/panel versi lama tetap tersedia untuk tes dan konsumen legacy; pembersihan menyeluruh tetap tahap 16.

Tahap berikutnya **7 — Riwayat dan unggah impor**, hanya setelah diminta. `docs/figures/` tidak diubah dan tidak dimasukkan checkpoint lokal.
