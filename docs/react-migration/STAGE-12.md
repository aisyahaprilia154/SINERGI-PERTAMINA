# Tahap 12 — Dialog peta dan ekspor

Selesai lokal pada 24 Oktober 2026, branch `react-migration-baseline`, dari checkpoint tahap 11 `12e4d20`. Permintaan “next” diterapkan untuk tahap 12 saja. Tahap 13 belum dimulai. Tidak ada push, merge, deployment atau perubahan database operasional.

## Bagian yang berubah

Dialog impor/ekspor pada peta kini memakai `MapTransferDialog` dengan JSX dan state React. `useMapTransfer` menyimpan snapshot konteks, area dan pilihan jaringan ketika dialog dibuka, tanpa memanggil binder dialog lama. Form, tab, validasi, progress, pesan error, retry dan kontrol unduhan dimiliki React. Native dialog mempertahankan fokus modal, Escape, backdrop serta pengembalian fokus ke pemicu. Draft nama/file tetap ada setelah kegagalan unggah dan ketika berpindah tab.

`useTransferActions` mempertahankan service, endpoint, multipart/payload, token dan polling 1200 ms. Unggah diserialkan dan hanya berasal dari submit pengguna. Polling mengikuti `statusUrl` respons, memeriksa ID jika tersedia, dan menuju preview memakai importId respons yang di-encode. Kegagalan sementara membaca status bisa dilanjutkan tanpa mengunggah file lagi. Config gagal memiliki retry; operasi belum dapat dimulai sebelum batas ukuran valid tersedia. Viewer hanya mendapat ekspor dan unduhan sumber.

Menutup dialog dengan draft meminta konfirmasi; menutup saat proses berjalan membatalkan request/polling klien setelah konfirmasi. Guard dialog juga diketahui halaman peta, sehingga perubahan revision dari tab lain tidak memuat ulang dan membuang draft unggahan. Guard dilepas sebelum navigasi sukses ke preview. Sesi kedaluwarsa mengakhiri pekerjaan klien dan kembali ke login. Timer, request, listener, decoding dan object URL dimiliki lifecycle dialog dan dibersihkan saat dilepas/pagehide; respons terlambat diabaikan. Pembatalan klien tidak menjamin pembatalan pekerjaan yang sudah diterima server.

Ekspor KML memakai `collectSelectedNetworkAssetIds` yang sama, termasuk endpoint/body/filename lama. Pilihan jaringan tanpa aset sekarang ditolak sebelum request: backend mengartikan daftar ID kosong sebagai tanpa filter, sehingga mengirimnya berisiko mengekspor seluruh dataset. Unduhan sumber mempertahankan ID versi dan nama UTF-8 dari server. Service KML menerima pembatalan dan status HTTP tanpa mengubah kontrak API.

## Diagram dan mesin yang dipertahankan

Pada baseline aktif, pemicu Diagram topologi di peta sebenarnya menavigasi ke halaman topologi. Modul dialog skematik sudah tersedia tetapi belum terhubung ke pemicu itu. Tahap ini menghubungkannya sebagai dialog React sesuai rencana pengguna; ini perubahan perilaku pemicu yang disengaja. Tautan Diagram Topologi pada header tetap membuka halaman topologi melalui pemuatan dokumen penuh. Halaman topologi itu masih legacy.

`SchematicDialog` dan `DiagramSummary` mengelola tiga cakupan, pencarian/keyboard, ringkasan, pilihan aset, kontrol zoom/pan/fit/reset, fullscreen beserta fallback, dan ekspor. `createMapDiagrams` menyusun input memakai graph/layout yang sudah ada. Algoritme graph, layout, SVG dan aturan relasi tidak diubah. Snapshot sumber tidak dimutasi.

`schematic-board-adapter` hanya memiliki container SVG/viewport melalui ref. Ia memakai `renderSchematicSvg`, loader ikon dan perhitungan viewport lama; toolbar, form dan ringkasan tetap JSX. Seleksi dan pemuatan ikon mempertahankan viewport. Listener pointer/wheel/keyboard, ResizeObserver, frame animasi dan request ikon dilepas bersama adapter. Instance MapLibre di belakang dialog tetap sama.

Mesin ekspor SVG/PNG lama dipertahankan, dengan opsi AbortSignal dan pemilik unduhan tambahan. PNG tetap memakai canvas, batas dimensi 8192 dan batas 40 juta pixel yang sudah ada. Source URL PNG selalu dilepas, termasuk pembatalan decoding. Ekspor menunggu ikon siap dan mencegah submit PNG ganda. Dialog tidak mengubah data peta.

## Hasil pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Node lama | 341 lulus |
| React / Vitest | 151 lulus, 11 berkas |
| Backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Playwright seluruh suite | 64/64 lulus dalam satu run |
| Smoke baseline | 10/10 kelompok lulus; errors/unexpected kosong |
| Lint | Root, frontend termasuk JSX/Hooks, backend lulus |
| Build | Frontend dist/client + dist/server/index.js dan backend lulus |

Sebanyak 22 tes React baru menguji StrictMode, config/error/retry, validasi, draft/file, submit berulang, status resume tanpa reupload, respons tidak cocok, navigasi preview, role, sesi, guard unload/revision, pembatalan/late response, kepemilikan URL, tiga cakupan diagram, pencarian keyboard, zoom, empty/error/retry, fullscreen fallback, cleanup adapter dan pembatalan PNG.

Delapan tes browser baru menjalankan halaman peta aktif dengan MapLibre asli dan API mock. Tes menguji unggah gagal/retry, URL preview dari respons, config/native validation, resume status, Viewer, payload KML sesuai pilihan, filename UTF-8, filter kosong, SVG dengan ikon tertanam, signature/dimensi PNG sungguhan, canvas peta persisten, pencarian/zoom, mobile/fullscreen fallback, pembatalan polling serta draft ketika revision berubah. Tes juga memastikan dialog aktif tidak mengimpor binder dialog lama.

Run diagnostik awal tes React menemukan masalah harness validasi file JSDOM dan selector Fit yang ambigu; harness diperbaiki dengan tetap menguji validasi native di browser. Lint menemukan satu import tes tak terpakai, yang dihapus. Run akhir seluruh pemeriksaan lulus tanpa menghapus/melemahkan tes lama. Browser memakai Chromium Headless Shell 156, satu worker, sesuai batas runtime yang dicatat pada tahap sebelumnya. Peringatan ukuran chunk MapLibre >500 kB tetap ada.

## Visual dan artefak

`capture-map-dialogs.cjs` mengambil 56 screenshot halaman dan 56 potongan dialog: impor, ekspor, seluruh aset, jaringan, jalur terpilih, pencarian dan kosong; masing-masing legacy/React pada desktop 1440×900, mobile 390×844, terang/gelap. Referensi legacy dibuka hanya melalui fixture development terisolasi, bukan rute produksi. Untuk diagram, pembanding adalah modul dialog lama yang tersedia, bukan klaim bahwa modal tersebut sudah aktif pada baseline peta.

Ke-28 pasangan potongan mempunyai ukuran sama. Pada ambang RGB >12 per kanal, 10 pasangan identik; 10 pasangan diagram berbeda 38–46 pixel (maksimum 0,015%); delapan pasangan transfer berbeda 688–2078 pixel (maksimum 1,28%). Selisih transfer berasal dari whitespace antar kontrol form/tombol yang bersebelahan pada JSX. Contact sheet, diff impor dan diagram mobile diperiksa secara visual. Kesamaan pixel seluruh halaman tidak diklaim. Tidak ada redesign CSS dialog.

Artefak di `stage-12/` berisi screenshot, contact-sheet.jpg, capture-results.json, visual-comparison.json, playwright-results.txt, verification-results.json, smoke-results.json serta log lint/build/tes. Fixture `e2e/fixtures/map-dialogs.html` hanya untuk pembandingan; tidak termasuk output produksi.

## Keadaan akhir dan batas verifikasi

Enam halaman aktif dan dialog peta memakai React. Topologi masih legacy; file halaman/binder lama dipertahankan sampai pembersihan tahap 16. Navigasi antarhalaman masih memuat dokumen penuh. API, database dan mesin graph/layout tidak dimigrasikan atau diganti.

Semua operasi tulis UI memakai API mock. Tes integrasi PostgreSQL dilewati karena `SINERGI_TEST_DATABASE_URL` tidak tersedia. Password akun asli, unggahan ke database operasional, seluruh tile eksternal dan fullscreen native lintas browser belum diverifikasi. Fullscreen fallback diuji pada browser dan unit.

Kode terbaru berjalan di Vite http://127.0.0.1:5173 dengan proxy backend Docker port 5001. Docker sehat; frontend Docker port 5174 tetap image lama tanpa rebuild/deployment. Penghapusan lokal `.env.docker.example`, folder pengguna `docs/figures/`, rahasia dan backup tidak masuk checkpoint.

Tahap berikutnya **13 — Pisahkan logika topologi**, setelah diminta. Berhenti setelah checkpoint tahap 12.
