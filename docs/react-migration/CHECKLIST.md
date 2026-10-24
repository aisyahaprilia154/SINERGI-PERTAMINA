# Migrasi React SINERGI — baseline dan checklist

Terakhir diperbarui: 24 Oktober 2026 (Asia/Jakarta). Tahap terakhir selesai: **15 — Edit topologi dan penyimpanan**.
Commit asal: `5375bd3` pada `main`. Branch kerja lokal: `react-migration-baseline`.
Rencana asli pengguna disimpan tanpa perubahan di [PLAN.md](PLAN.md).

## Hasil tahap 1

- [x] Periksa working tree sebelum pengerjaan; tidak ada perubahan tracked.
- [x] Catat tiga file lokal untracked berikut beserta ukuran dan SHA-256 di [local-files-before.json](local-files-before.json).
  - `docs/PANDUAN-HANDOVER.md`
  - `docs/handover/Panduan Instalasi dan Operasional SINERGI.docx`
  - `docs/handover/Panduan Instalasi dan Operasional SINERGI Format Revisi.docx`
- [x] Pertahankan isi file lokal tersebut dan sertakan dalam checkpoint lokal tahap 1.
- [x] Instal dependency frontend/backend menggunakan `npm ci`; package.json dan lockfile tetap.
- [x] Inventaris tujuh halaman, kontrak bersama, dan interaksi yang perlu dipertahankan.
- [x] Rekam 28 screenshot: tujuh halaman × desktop/mobile × light/dark.
- [x] Periksa contact sheet secara visual; tata letak lama menjadi referensi, tanpa redesign.
- [x] Jalankan baseline frontend: **336 lulus, 0 gagal**.
- [x] Jalankan baseline backend: **75 lulus, 0 gagal, 1 dilewati**.
- [x] Build frontend/backend dan lint root/frontend/backend berhasil.
- [x] Jalankan 10 kelompok smoke browser dengan API mock; tidak ada uncaught page error atau endpoint tak dikenal.
- [x] Simpan checkpoint Git lokal setelah pemeriksaan, tanpa push/merge/deployment.

Angka 340/341 dari rencana bukan hasil checkout ini. Percobaan pertama gagal memuat tiga berkas tes karena `jsdom` belum terpasang; setelah `npm ci`, seluruh 336 tes frontend lulus. Tidak ada tes kelas CSS yang masih gagal, sehingga tidak ada markup, assertion, atau kode aplikasi yang diubah untuk memaksakan kondisi rencana.

## Inventaris perilaku tujuh halaman

Daftar ini adalah kontrak untuk migrasi, bukan pernyataan bahwa semua interaksi telah diuji end-to-end pada tahap 1. Tes Node yang sudah ada tetap menjadi bukti perilaku terotomasi; kolom browser hanya menyebut pemeriksaan yang benar-benar dijalankan.

| Halaman / entrypoint | Interaksi dan kontrak yang harus dipertahankan | Bukti browser tahap 1 |
| --- | --- | --- |
| Login `/`, `src/pages/login-page.js` | Username/email; validasi form; tampil/sembunyikan password; loading/disabled; pesan error; retry; tema; redirect setelah masuk | Empat screenshot; toggle password; login ditolak API mock; tombol kembali aktif; redirect anonymous dan sesi berakhir |
| Kelola pengguna `/admin/users`, `src/pages/admin/users-page.js` | Daftar; pencarian; filter role; tambah/edit; reset password; draft; konfirmasi buang; fokus/keyboard; konflik `updatedAt`; administrator terakhir; pencabutan sesi; online; refresh 15 detik | Empat screenshot; pencarian kosong; filter Viewer; drawer dan perlindungan draft lewat Escape; Viewer dialihkan ke peta |
| Versi database `/admin/datasets/versions`, `src/pages/admin/dataset-versions-page.js` + `dataset-versions-panel.js` | Dataset context; maksimal 10 checkpoint; indikator aktif; simpan; restore dengan konfirmasi; expectedRevision; konflik; refresh/focus; kontrol saat sibuk | Empat screenshot versi aktif; keadaan versi kosong; buka/tutup dialog simpan; fokus kembali ke tombol |
| Riwayat/unggah `/admin/datasets/import`, `src/pages/admin/import-dataset-page.js` | Pilihan dataset; riwayat/status; file sumber; drawer; nama/file draft; validasi KML/KMZ/ukuran; upload XHR/progress; polling; preview; proteksi unload | Empat screenshot; keadaan riwayat kosong; drawer; file TXT ditolak sebelum API upload. **Source saat ini belum menyediakan pencarian/filter riwayat**; jika ditambahkan nanti, catat sebagai perubahan fitur terpisah |
| Preview `/admin/datasets/import/:id/preview`, `src/pages/admin/preview-import-page.js` | Ringkasan; tambahan aset; konflik/match/endpoint; tampilkan aset lama; hitung ulang; unduh sumber; apply dengan baseRevision; kamera peta | Empat screenshot preview siap diterapkan dengan tambahan kamera; tombol apply terdeteksi siap. Tidak menekan apply atau mengubah data |
| Peta `/map` (alias `/peta`), `src/pages/map/map-page.js` | Scope area; jaringan/layer; pencarian; URL state; seleksi aset/relasi; MapLibre; zoom/fit/basemap; legenda/CCTV; detail/ikon; pemasangan; diagram; impor/ekspor; role/revision; mobile | Empat screenshot dengan dua aset dan satu koneksi; API error dan retry; pencarian aset; akses Viewer. Dataset kecil dan basemap kosong yang dimock |
| Topologi `/topology` (alias `/topologi`), `src/pages/topology/topology-page.js` | Overview/detail area; pencarian; seleksi/fokus; viewport; filter; frame; drag/pemasangan; koneksi; nama/hapus; draft/simpan/batal; konflik revision; ekspor SVG/PNG; role | Empat screenshot overview; zoom-in/reset. Detail besar, drag, simpan dan ekspor belum diuji browser di tahap ini |

Untuk tujuh halaman di atas, checklist pemeriksaan ulang setiap tahap migrasi adalah:

- [ ] Perilaku normal sesuai kolom inventaris dan role yang diizinkan.
- [ ] Loading, data kosong, error API, retry, submit berulang, konflik revision.
- [ ] Draft tidak hilang dan respons request usang tidak mengganti state terbaru.
- [ ] Desktop 1440×900 dan mobile 390×844; tema terang/gelap.
- [ ] Tab, fokus masuk/kembali, Escape dan focus trap sesuai komponen.
- [ ] Tidak ada peta/listener/timer/worker ganda; cleanup ketika dilepas.
- [ ] Tidak ada perubahan endpoint, payload, token, kunci storage, atau URL tanpa alasan tercatat.

Checklist kosong di bagian ini sengaja merupakan template untuk tahap berikutnya; bukan kegagalan pemeriksaan baseline yang sudah tercantum di atas.

## Kontrak bersama

- Routing lama: `frontend/src/main.js`; auth check sebelum mount; Administrator untuk `/admin/*`; pemuatan dokumen penuh; alias `/peta` dan `/topologi` dipertahankan.
- Session storage: `sinergiSessionToken`, `sinergiSessionUser`, `sinergiActiveDatasetId`.
- Local storage: `sinergi.theme`, `sinergi:revision:<datasetId>` serta preferensi topologi yang dipakai source.
- Sesi melalui `/api/auth/login`, `/me`, `/logout`, `/heartbeat`; heartbeat 30 detik dan timeout sesi tetap merupakan tanggung jawab service/backend.
- Dataset: `/api/datasets/:id/active`, `/diagram`, `/versions`, relasi/ikon/ekspor; header bearer token dan pemeriksaan revision tetap.
- MapLibre mengelola container-nya; adapter peta saat ini memakai `destroy()`. Saat migrasi adapter boleh menyediakan `dispose()` yang memanggil cleanup asli, tanpa mengasumsikan method tersebut sudah tersedia.
- File KML/KMZ dan data operasional tidak disentuh oleh capture/smoke; seluruh `/api/**` diintersep.
- Output build harus mempertahankan `dist/client`, worker `dist/server`, proxy `/api` dan fallback URL langsung Nginx.

## Verifikasi dan batasnya

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend `npm test` / `node --test` | 336/336 lulus |
| Backend `npm test` | 75 lulus; 1 tes integrasi dilewati karena `SINERGI_TEST_DATABASE_URL` tidak disediakan |
| Root/frontend/backend `npm run lint` | Berhasil; lint lama masih syntax check, belum ESLint JSX/Hooks |
| Frontend `npm run build` | Berhasil; bundle MapLibre melampaui peringatan 500 kB yang sudah ada |
| Backend `npm run build` | Berhasil; manifest 34 source files |
| Screenshot Playwright pada Edge headless | 28/28, tanpa uncaught page error dan tanpa API tak dikenal |
| Smoke Playwright pada Edge headless | 10 kelompok pemeriksaan, dengan seluruh API dimock |

Lingkungan shell menggunakan Node 24.13.0. `npm ci` memberi EBADENGINE untuk beberapa dependency dev jsdom yang meminta patch Node lebih baru. Tes frontend juga dijalankan ulang dengan runtime bundled **Node 24.19.0** yang memenuhi syarat, dan tetap 336/336 lulus. Untuk tahap 2 gunakan runtime yang memenuhi engines dependency.

Screenshot memakai fixture kecil, tanggal data tetap, locale id-ID, timezone Asia/Jakarta, dan vector basemap kosong dengan metadata layer yang dimock. Peta eksternal/satelit, jaringan perusahaan, database PostGIS hidup, dataset produksi besar, proses write nyata, pengukuran kebocoran memori dan Docker belum diverifikasi tahap ini. Saat ini capture overview topologi; perlu menambah baseline detail/drag pada tahap 13 sebelum perubahan topologi.

## Menjalankan ulang baseline browser

1. Dari `frontend`, jalankan `npm run dev -- --host 127.0.0.1 --port 5173`.
2. Pastikan package `playwright` tersedia pada Node resolution (`NODE_PATH` jika memakai runtime bundled) dan Microsoft Edge terpasang. Tidak ada dependency aplikasi yang ditambahkan untuk skrip baseline.
3. Dari root: `node docs/react-migration/capture-baseline.cjs` dan `node docs/react-migration/smoke-baseline.cjs`.
4. Browser default `msedge`; override dengan environment `BASELINE_BROWSER_CHANNEL` jika diperlukan.
5. Hasil tersimpan pada `baseline/`; lihat `capture-results.json`, `smoke-results.json`, dan `contact-sheet.jpg`.

## Status urutan migrasi

- [x] 1. Baseline dan checklist.
- [x] 2. Fondasi React dan pengujian — lihat [laporan tahap 2](STAGE-2.md).
- [x] 3. Login, sesi, dan penjagaan akses — lihat [laporan tahap 3](STAGE-3.md).
- [x] 4. Komponen bersama — lihat [laporan tahap 4](STAGE-4.md).
- [x] 5. Kelola pengguna — lihat [laporan tahap 5](STAGE-5.md).
- [x] 6. Versi database — lihat [laporan tahap 6](STAGE-6.md).
- [x] 7. Riwayat dan unggah impor — lihat [laporan tahap 7](STAGE-7.md).
- [x] 8. Preview impor — lihat [laporan tahap 8](STAGE-8.md).
- [x] 9. Pisahkan logika peta — lihat [laporan tahap 9](STAGE-9.md).
- [x] 10. Peta React untuk membaca data — disiapkan dan diuji; rute aktif masih legacy.
- [x] 11. Detail dan edit aset di peta — kedua alias peta aktif memakai React; dialog transfer lama dipertahankan sementara.
- [ ] 12. Dialog peta dan ekspor — **tahap berikutnya, menunggu permintaan baru**.
- [ ] 13. Pisahkan logika topologi.
- [ ] 14. Topologi React untuk membaca data.
- [ ] 15. Edit topologi dan penyimpanan.
- [ ] 16. Integrasi akhir dan hapus jalur lama.

Catatan integrasi untuk dievaluasi ketika mencapai tahap terkait: jangan mengaktifkan peta React tanpa seluruh dialog/ekspor yang sudah tersedia; perlindungan draft pada reload/perpindahan dokumen harus hadir ketika fitur edit diaktifkan, sebelum penjagaan navigasi SPA tahap 16. Rencana asli tetap disimpan utuh di PLAN.md.

Tidak ada halaman React aktif pada tahap 1 maupun tahap 2. Ketujuh halaman tetap memakai implementasi vanilla yang sama. Checkpoint tahap 1 berisi dokumentasi, artefak baseline, skrip verifikasi, dan tiga file handover lokal sebelumnya. Checkpoint tahap 2 menambahkan fondasi dan pengujian terisolasi; belum mengaktifkan UI React pada rute aplikasi.

Mulai tahap 3, login `/` dan fallback URL publik memakai React. Enam halaman lain masih legacy. Kebijakan akses dan service akun dipakai bersama; lihat STAGE-3.md untuk hasil pemeriksaan terbaru.

Tahap 4 menyiapkan komponen bersama dan memakainya untuk logo/tombol tema login. Header/admin, tabel, overlay, dan kontrol workspace React diuji terisolasi; belum mengambil alih enam halaman legacy. Hasil terbaru ada di STAGE-4.md.

## Hasil tahap 5

- [x] Aktifkan `/admin/users` dengan JSX, AdminLayout, tabel, dan drawer React; tanpa renderer/binder halaman lama.
- [x] Pertahankan pencarian, filter, tambah/edit, reset password, status online, refresh 15 detik, dan kontrak API/token/expectedUpdatedAt.
- [x] Verifikasi administrator terakhir, snapshot revision/draft saat refresh dan konflik, pencabutan sesi, dan penolakan Viewer.
- [x] Verifikasi validasi native, submit berulang, Escape/fokus, konfirmasi buang draft, beforeunload, empty/error/retry, polling visible/hidden, abort dan respons terlambat.
- [x] Bandingkan daftar dengan baseline awal serta lima keadaan halaman/drawer dengan implementasi lama pada desktop/mobile, terang/gelap: 40 screenshot, 24 perbandingan, 0 pixel berbeda pada ambang RGB > 12 per kanal.
- [x] Frontend: 336 tes lama + 55 tes React lulus; browser: 26 tes lulus dalam satu run; smoke baseline: 10 kelompok lulus.
- [x] Backend: 75 lulus, 1 integrasi PostgreSQL dilewati; build frontend/backend dan lint root/frontend/backend berhasil.
- [x] Checkpoint lokal tahap 5 setelah pemeriksaan; folder pengguna `docs/figures/` tidak disertakan. Tidak ada push/merge/deployment.

Login dan Kelola pengguna kini aktif memakai React. Lima halaman lain masih legacy. Seluruh API browser memakai mock; database Docker asli dan akun dari komputer lama belum dipulihkan. Hasil dan batas verifikasi terbaru ada di [STAGE-5.md](STAGE-5.md).

## Hasil tahap 6

- [x] Aktifkan `/admin/datasets/versions` dengan JSX dan komponen bersama React; tanpa renderer/binder versi lama.
- [x] Pertahankan prioritas pemilihan dataset, daftar versi, indikator aktif, label batas 10, checkpoint, konfirmasi restore, dan status proses.
- [x] Pertahankan endpoint/payload/token, expectedRevision saat dialog dibuka, revision storage dan context URL. Service menerima AbortSignal opsional.
- [x] Verifikasi submit tunggal, validasi nama, busy, konfirmasi, fokus/Escape, konflik 409, retry, status existing dan nama draft pada kegagalan biasa.
- [x] Verifikasi pergantian dataset, scope listener focus/storage, cleanup ketika dilepas, abort read/write/config dan respons terlambat termasuk penulisan revision storage.
- [x] Bandingkan daftar/dialog simpan/dialog restore/empty dalam desktop/mobile dan terang/gelap: 32 screenshot, 20 pasangan identik termasuk 4 perbandingan terhadap baseline awal.
- [x] Frontend: 336 tes Node lama + 73 tes React; Playwright: 34 tes; smoke baseline: 10 kelompok, semuanya lulus.
- [x] Backend: 75 lulus, 1 integrasi PostgreSQL dilewati; build frontend/backend dan lint root/frontend/backend berhasil.
- [x] Checkpoint Git lokal setelah pemeriksaan; tidak ada push/merge/deployment. `docs/figures/` tidak diubah atau dimasukkan checkpoint.

Login, Kelola pengguna, dan Versi database aktif memakai React. Riwayat/unggah, preview impor, peta dan topologi masih legacy. Semua operasi tulis UI memakai API mock; login/database Docker asli belum diverifikasi. Hasil terbaru: [STAGE-6.md](STAGE-6.md).

## Hasil tahap 7

- [x] Aktifkan `/admin/datasets/import` dan trailing slash dengan JSX, AdminLayout, DataTable, dan Drawer React; tanpa renderer/binder riwayat lama pada rute aktif.
- [x] Pertahankan dataset, daftar/status/sumber, draft, validasi file, multipart/Bearer, progress, polling 1200 ms, serta navigasi dokumen penuh ke preview memakai importId dari respons.
- [x] Tambahkan pencarian nama/file dan filter status lokal sesuai rencana; tambahan toolbar dicatat sebagai perubahan dari baseline.
- [x] Verifikasi error/retry, submit berulang, busy, Escape/fokus, konfirmasi buang draft, beforeunload, sesi/role, abort pada unmount/pagehide, respons terlambat dan cleanup object URL/timer.
- [x] Visual desktop/mobile terang/gelap: 32 screenshot halaman + 32 potongan, 16 pasangan pembanding. Tabel/header identik, panel konfirmasi identik pada ambang RGB >12, panel form berbeda 39–53 pixel (<0,02%); tambahan toolbar disengaja.
- [x] Frontend: 336 tes Node lama + 87 tes React lulus; backend: 77 lulus, 1 integrasi PostgreSQL dilewati. Lint dan build root/frontend/backend yang relevan berhasil.
- [x] Playwright: 39/39 lulus dalam satu run pada Chromium Headless Shell 156; smoke baseline: 10/10 kelompok lulus, semua API dimock. Edge timeout dan Chromium standar gagal start side-by-side; rincian/reproduksi ada di laporan.
- [x] Checkpoint Git lokal setelah verifikasi; tidak ada push/merge/deployment. Folder docs/figures/, penghapusan .env.docker.example, rahasia dan backup database tidak disertakan.

Login, Kelola pengguna, Versi database, dan riwayat/unggah kini memakai React. Preview impor, peta, dan topologi masih legacy. Docker sehat di port 5174 dengan image sebelum tahap 7; kode terbaru Vite di port 5173 memakai backend Docker port 5001. Seluruh operasi tulis pengujian memakai API mock. Hasil: [STAGE-7.md](STAGE-7.md). Tahap berikutnya **8 — Preview impor**, hanya setelah diminta.


## Hasil tahap 8

Preview impor kini aktif memakai React dengan tabel/konflik/endpoint/konteks aset lama, hitung ulang, sumber, apply dan adapter MapLibre terisolasi. Revision 409 memuat data terbaru; request/polling/map/object URL dibersihkan. Frontend 336 + 97 tes, backend 77 lulus/1 skip, browser 43/43, smoke 10/10, lint dan build lulus. Visual 32 halaman + 24 potongan, 12 pasangan header/tabel/konflik identik dalam desktop/mobile dan terang/gelap. Peta/topologi tetap legacy. Lanjut tahap 9 lalu 10 sesuai izin pengguna, tanpa push/deploy. [Laporan tahap 8](STAGE-8.md).


## Hasil tahap 9

Pencarian, area/scope/hitungan, target relasi, label/preset, konteks dan ID URL kini modul murni. State seleksi/URL dan traversal graph dipindah dengan facade kompatibilitas. Model komposisi siap dipakai React; halaman peta masih legacy. Bukti 21 fungsi + 2 modul identik dengan checkpoint tahap 8 (normalisasi export/input konteks), 341 tes Node + 97 React, backend 77 lulus/1 skip, lint/build lulus. Empat pasangan visual final identik dan smoke 10/10 lulus. Browser mencakup 43 kasus melalui 42/43 pada run utama dan 2/2 uji ulang kasus login/unduhan yang sempat terganggu; bukan satu run bersih. [Rincian tahap 9](STAGE-9.md). Lanjut tahap 10 sesuai izin pengguna lalu berhenti.

## Hasil tahap 10

UI baca peta memakai JSX untuk sidebar, area/jaringan/preset, pencarian, CCTV, basemap, zoom, legenda dan mobile; MapLibre terisolasi melalui adapter persisten. State URL/back/forward, fokus, role, loading/error/retry/empty serta cleanup request/listener/renderer/ikon diverifikasi. Rute produksi peta tetap legacy, UI React baru tersedia di fixture development sampai tahap aktivasi. Detail/edit dan dialog/ekspor belum dimigrasikan. Frontend 341 Node + 114 React, backend 77 lulus/1 skip, browser penuh 49/49 plus 10/10 ulang terdampak perubahan akhir, smoke 10/10, lint/build lulus. Visual 56 halaman + 40 potongan; 20 pasangan komponen, 16 identik dan empat berbeda 5–17 pixel (<0,01%). Lima halaman aktif React; peta dan topologi aktif tetap legacy. [Laporan tahap 10](STAGE-10.md). Tahap 8–10 selesai berurutan sesuai izin pengguna; berhenti di sini tanpa memulai tahap 11. Tidak ada push/deployment.

## Hasil tahap 11

`/map` dan `/peta`, termasuk trailing slash, aktif memakai React. Drawer detail, ganti/hapus ikon, pencarian/tambah/ganti/hapus relasi, serta relasi pemasangan dikelola JSX. Kontrak revision schema 2 dan lama ditangani, write diserialkan, error/409 menjaga proyeksi dan draft, respons aset lama diabaikan. MapLibre mempertahankan canvas/kamera dan hanya memperbarui proyeksi miliknya; daftar aksesibilitas React tidak lagi ditulis renderer. Draft, fokus, mobile, request/decoder/object URL serta cleanup diverifikasi. Dialog transfer lama tetap tersedia melalui bridge sampai tahap 12; topologi tetap legacy. Frontend 341 Node + 129 React, backend 77 lulus/1 skip, browser 56/56 dalam satu run, smoke 10/10, lint/build lulus. Visual 40 halaman + 40 potongan: 20 pasangan berukuran sama, 12 identik, delapan berbeda paling banyak 0,26% karena fokus. [Laporan tahap 11](STAGE-11.md). Checkpoint lokal setelah pemeriksaan; berhenti sebelum tahap 12. Tidak ada push/deployment atau perubahan database.

## Hasil tahap 12

- [x] Dialog transfer memakai JSX: draft nama/file, validasi, progress, retry config/status, unggah tunggal dan preview dari importId respons.
- [x] Ekspor KML mempertahankan pilihan jaringan; filter kosong ditolak. Unduhan sumber mempertahankan filename UTF-8.
- [x] Dialog diagram React terhubung ke pemicu peta; tiga cakupan, pencarian, ringkasan, zoom/pan/fit/reset/fullscreen serta SVG/PNG memakai mesin lama. Header tetap menautkan halaman topologi legacy.
- [x] Native modal/fokus/Escape, role/sesi, draft/revision guard, timer/polling/request/listener/observer/RAF/decoder/object URL dan respons terlambat diverifikasi.
- [x] Frontend 341 Node + 151 React, backend 77 lulus/1 skip, browser penuh 64/64, smoke 10/10, lint/build lulus.
- [x] Visual 56 halaman + 56 potongan, 28 pasangan berukuran sama: 10 identik, 10 diagram berbeda maksimal 46 pixel (<0,015%), delapan transfer maksimal 1,28% akibat whitespace kontrol. Desktop/mobile dan terang/gelap diperiksa.
- [x] Checkpoint Git lokal setelah pemeriksaan; perubahan pengguna, rahasia dan backup tidak disertakan. Tidak ada push/merge/deployment atau perubahan database.

Enam halaman dan dialog peta aktif memakai React; topologi masih legacy. Diagram modal sebelumnya tersedia sebagai modul tetapi belum terhubung ke pemicu aktif; penghubungan baru ini dicatat sebagai perubahan perilaku dalam [STAGE-12.md](STAGE-12.md). Seluruh operasi tulis pengujian memakai API mock. Tahap berikutnya **13 — Pisahkan logika topologi**, setelah diminta; berhenti di tahap 12.

## Hasil tahap 13

- [x] Pisahkan working document/snapshot/draft/save/refresh, state awal, seleksi/pencarian/traversal, komposisi model/layout, loading, SVG renderer dan lifecycle workspace. Halaman topologi tetap legacy.
- [x] Pertahankan aturan graph/layout, markup, CSS, API/payload/revision, URL/storage, serta efek tulis dari tindakan pengguna.
- [x] Buktikan 17 modul mesin/domain + empat CSS identik dengan tahap 12, 11 fungsi identik setelah normalisasi batas modul, dan 18 kasus model/layout identik.
- [x] Verifikasi draft/cancel/konflik/retry/save tunggal/Viewer, abort read/write terlambat, remount, debounce, ikon, listener/timer/RAF/observer/pointer/renderer serta cleanup subscription dan object URL. Worker lama tidak diaktifkan; kepemilikan worker diuji dengan stub.
- [x] Frontend 341 tes Node lama + 163 Vitest, backend 77 lulus/1 skip, lint/build lulus. Tes statis memeriksa lokasi modul baru dengan assertion wiring tambahan.
- [x] Browser awal 67/68 karena timeout canvas peta; run ulang penuh 68/68 lulus tanpa perubahan timeout/assertion. Empat kasus topologi baru lulus; smoke 10/10.
- [x] Visual 24 sebelum + 24 sesudah, desktop/mobile terang/gelap: 18 pasangan identik, enam berbeda maksimal 0,284%, terbatas pada kontrol zoom/navigasi. Diagram fasilitas, overview, detail, pencarian, kosong dan error dibandingkan.
- [x] Checkpoint Git lokal setelah pemeriksaan; perubahan pengguna, rahasia dan backup tidak disertakan. Tidak ada push/merge/deployment atau perubahan database operasional.

Enam halaman dan dialog peta tetap React; topologi tetap legacy. Tahap ini tidak mengaktifkan halaman React baru. Semua operasi tulis UI diuji dengan API mock; integrasi PostgreSQL terpisah belum tersedia. [Laporan tahap 13](STAGE-13.md). Tahap berikutnya **14 — Topologi React untuk membaca data**, setelah diminta; berhenti di tahap 13.

## Hasil tahap 14

- [x] Siapkan JSX untuk topologi baca: pilihan fasilitas, pencarian/keyboard, panel aset/relasi, tray, legenda, zoom/pan/fit/reset, tema/mobile dan loading/error/kosong/retry. Header dan provider bersama dipakai; tidak membungkus halaman/binder lama.
- [x] Adapter hanya memiliki SVG/viewport dan lifecycle; label overlay dikirim sebagai data ke React. Instance/frame bertahan selama seleksi/tema, source immutable, fokus SVG dan penutupan sidebar/inspector dipulihkan.
- [x] Pertahankan URL/storage/context/role/sesi/revision; uji respons terlambat, StrictMode, retry renderer, abort, listener/timer/frame/observer/ikon dan disposal.
- [x] Buktikan 21 sumber lama tetap identik, 13 fungsi viewport dan posisi label sama. Halaman/rute produksi `/topology` dan `/topologi` tetap legacy; React hanya pada fixture development.
- [x] Visual 56 halaman + 56 potongan, 28 pasangan berukuran sama: 18 identik, 10 berbeda 118–472 pixel, maksimum 0,083% akibat kontrol nonaktif. Semua 20 SVG dan 24 metrik viewport identik. Desktop/mobile terang/gelap diperiksa dengan reduced motion untuk capture; tes interaktif memakai default.
- [x] Frontend 341 tes Node lama + 179 Vitest, backend 77 lulus/1 skip, browser penuh 74/74 dan smoke 10/10 lulus. Build/lint lulus dan frontend diulang sesudah perbaikan fokus terakhir.
- [x] Edit/drag/relasi/draft/save/ekspor belum diimplementasikan pada UI baru; kontrol terkait nonaktif, Viewer tidak mendapat kontrol Administrator. Tidak ada write dataset pada UI baca.
- [x] Checkpoint Git lokal sesudah pemeriksaan; perubahan pengguna, rahasia dan backup tidak disertakan. Tidak ada push/merge/deployment atau perubahan database operasional.

Enam halaman dan dialog peta aktif tetap React; topologi produksi tetap legacy. JSX topologi siap dipakai tahap berikutnya melalui fixture development, belum masuk bundle halaman produksi. [Laporan tahap 14](STAGE-14.md). Tahap berikutnya **15 — Edit topologi dan penyimpanan**, termasuk aktivasi setelah kriterianya lulus; berhenti di tahap 14.


## Hasil tahap 15

- [x] Aktifkan `/topology` dan `/topologi` dengan UI React untuk edit relasi, frame/penempatan/nama, drag posisi dan perpindahan turunan JB, draft/Batal/Simpan/revision serta ekspor SVG/PNG. Operasi hapus frame tidak tersedia pada baseline dan tidak ditambahkan.
- [x] Pertahankan mesin graph/layout, aturan kamera/mounting, kontrak API/payload/revision, sesi/role, URL/storage dan navigasi dokumen. Semua efek tulis berasal dari tindakan pengguna.
- [x] Verifikasi cancel/rollback, konflik dan retry, submit tunggal, simpan/reload posisi dan frame, beforeunload, Viewer, async setelah unmount/pagehide, keyboard/fokus/Escape, listener/request/timer/RAF/observer/pointer/ghost/auto-pan/renderer/object URL. Gerakan drag dan zoom tidak merender ulang seluruh UI.
- [x] Perbaiki input nama, akses keyboard custom frame, lapisan panel ekspor serta pergeseran kanvas mobile saat inspector ditutup; 21 sumber lama, 13 fungsi viewport dan posisi label tetap identik.
- [x] Visual desktop/mobile terang/gelap: 40 halaman + 40 potongan; 17/20 pasangan potongan identik. Dua panel ekspor berbeda karena kini terlihat, satu input berbeda karena highlight teks. Seluruh 20 viewport identik; 16 SVG mentah identik dan empat hanya menambah atribut keyboard custom frame.
- [x] Frontend 341 Node + 192 Vitest, backend 77 lulus/1 skip; browser seluruh suite 80/80 lalu 16/16 topologi setelah perbaikan akhir; smoke 10/10; lint/build lulus. Detail urutan dan batas verifikasi ada di laporan.
- [x] Checkpoint Git lokal sesudah pemeriksaan; perubahan pengguna, rahasia dan backup tidak disertakan. Tidak ada push/merge/deployment atau perubahan database operasional.

Semua tujuh halaman utama dan dialog peta sekarang aktif React. Entrypoint transisi serta kode halaman/binder lama masih disimpan untuk pembersihan tahap 16; navigasi tetap dokumen penuh. [Laporan tahap 15](STAGE-15.md). Tahap berikutnya **16 — Integrasi akhir dan hapus jalur lama**, setelah diminta; berhenti di tahap 15.
