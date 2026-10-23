# Migrasi React SINERGI — baseline dan checklist

Tanggal: 23 Oktober 2026 (Asia/Jakarta). Tahap terakhir selesai: **4 — komponen bersama**.
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
- [ ] 5. Kelola pengguna — **tahap berikutnya**.
- [ ] 6. Versi database.
- [ ] 7. Riwayat dan unggah impor.
- [ ] 8. Preview impor.
- [ ] 9. Pisahkan logika peta.
- [ ] 10. Peta React untuk membaca data.
- [ ] 11. Detail dan edit aset di peta.
- [ ] 12. Dialog peta dan ekspor.
- [ ] 13. Pisahkan logika topologi.
- [ ] 14. Topologi React untuk membaca data.
- [ ] 15. Edit topologi dan penyimpanan.
- [ ] 16. Integrasi akhir dan hapus jalur lama.

Catatan integrasi untuk dievaluasi ketika mencapai tahap terkait: jangan mengaktifkan peta React tanpa seluruh dialog/ekspor yang sudah tersedia; perlindungan draft pada reload/perpindahan dokumen harus hadir ketika fitur edit diaktifkan, sebelum penjagaan navigasi SPA tahap 16. Rencana asli tetap disimpan utuh di PLAN.md.

Tidak ada halaman React aktif pada tahap 1 maupun tahap 2. Ketujuh halaman tetap memakai implementasi vanilla yang sama. Checkpoint tahap 1 berisi dokumentasi, artefak baseline, skrip verifikasi, dan tiga file handover lokal sebelumnya. Checkpoint tahap 2 menambahkan fondasi dan pengujian terisolasi; belum mengaktifkan UI React pada rute aplikasi.

Mulai tahap 3, login `/` dan fallback URL publik memakai React. Enam halaman lain masih legacy. Kebijakan akses dan service akun dipakai bersama; lihat STAGE-3.md untuk hasil pemeriksaan terbaru.

Tahap 4 menyiapkan komponen bersama dan memakainya untuk logo/tombol tema login. Header/admin, tabel, overlay, dan kontrol workspace React diuji terisolasi; belum mengambil alih enam halaman legacy. Hasil terbaru ada di STAGE-4.md.
