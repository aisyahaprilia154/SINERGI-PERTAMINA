# Tahap 10 — Peta React untuk membaca data

Selesai 24 Oktober 2026, lokal pada branch `react-migration-baseline`, berdasarkan checkpoint tahap 9 `beb758c`. Pengguna mengizinkan tahap 8, 9, lalu 10 berjalan berurutan tanpa konfirmasi tambahan. Pengerjaan berhenti setelah tahap ini; tahap 11 belum dimulai.

## Hasil dan rute

Halaman baca peta telah dibuat dengan komponen JSX: header, sidebar, pemilihan area/jaringan, preset, pencarian dengan keyboard, CCTV, basemap, zoom/fit, legenda, status, error/retry, data kosong dan panel mobile. Tema dan sesi memakai Context bersama; state kontrol memakai React dan model domain hasil tahap 9. Seleksi mempertahankan ID kanonis, parameter URL lain, hash, serta back/forward. Memilih ulang aset memfokuskan peta tanpa menambah history duplikat.

MapLibre mengelola container khusus melalui adapter dengan satu instance selama pembaruan kontrol. Pembaruan UI tidak membuat ulang canvas atau menggeser kamera tanpa tindakan seleksi. Adapter membersihkan renderer, ResizeObserver, request ikon dan respons factory terlambat. Request dataset serta listener revision/pagehide dibersihkan. Signal opsional pada loader ikon juga dipakai adapter preview aktif; tes tambahan membuktikan abort dan pengabaian respons ikon terlambat.

**Rute produksi `/map` dan `/peta` tetap memakai halaman lama**, sesuai kriteria tahap 10. `MapRoute.jsx` belum didaftarkan di router produksi. UI baru diuji melalui fixture development `/e2e/fixtures/map.html?datasetId=dataset-semarang`, dengan StrictMode dan satu React root; fixture tidak termasuk entry build produksi. Aktivasi peta menunggu tahap 11 dan evaluasi kelengkapan dialog/ekspor sesuai catatan integrasi checklist. Detail/edit aset belum dimigrasikan; dialog impor/ekspor/diagram tetap lingkup tahap 12. UI baru tidak dianggap pengganti lengkap halaman peta pada tahap ini.

Lima halaman aktif sudah React: login, pengguna, versi database, riwayat/unggah dan preview impor. Peta aktif dan topologi masih legacy. Navigasi tetap memuat dokumen penuh.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Frontend Node lama | 341 lulus |
| React / Vitest | 114 lulus, 9 berkas |
| Backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Browser Playwright seluruh suite | 49/49 lulus dalam satu run |
| Ulang browser terdampak perubahan akhir | 10/10 peta dan preview lulus |
| Smoke baseline | 10/10 kelompok lulus; tidak ada page error / endpoint tak dikenal |
| Lint | Root, frontend termasuk JSX/Hooks, dan backend lulus |
| Build | Frontend dan backend lulus; frontend diulang setelah perubahan terakhir |

Run penuh 49 kasus dilakukan sebelum penyempurnaan terakhir pada guard UI kosong, CSS container desktop dan abort ikon preview. Semua 10 kasus browser peta/preview serta 114 tes React lulus kembali pada sumber akhir. Tidak ada assertion yang dihapus atau timeout yang dinaikkan untuk meluluskan pemeriksaan. Build masih mengeluarkan peringatan ukuran chunk MapLibre yang sudah ada; output `dist/client` dan `dist/server/index.js` dipertahankan.

Tes mencakup role Viewer/Administrator, loading/error/retry/empty, pencarian keyboard, Escape/fokus, mobile, network/preset/CCTV, kamera/canvas stabil, history URL, revision, pembatalan request saat meninggalkan halaman, respons terlambat, kegagalan renderer dan retry tanpa mengambil ulang dataset. Operasi tulis seluruh pengujian UI menggunakan API mock. Endpoint, payload dan database tidak diubah.

Browser memakai Playwright Chromium Headless Shell 156 dengan `BASELINE_BROWSER_CHANNEL=chromium-headless-shell`; nama project konfigurasi tetap `desktop-edge`. Edge sebelumnya tidak stabil pada laptop ini dan Chromium standar gagal memulai karena side-by-side assembly Windows. Runtime Node yang tersedia saat pemeriksaan akhir adalah 24.22.1. Shell dapat disiapkan dengan `node frontend/node_modules/playwright/cli.js install chromium --only-shell`.

## Perbandingan visual

`capture-map-read.cjs` merekam implementasi lama dan React dalam desktop 1440×900/mobile 390×844, terang/gelap, untuk default, jaringan terbuka, legenda, basemap, pencarian, kosong dan error: **56 screenshot halaman dan 40 potongan komponen**. Script memastikan modul implementasi yang benar dimuat dan menunggu font serta paint peta.

`compare-map-read.py` membandingkan 20 pasangan komponen pada ambang RGB >12 per kanal: **16 identik**, empat potongan sidebar berbeda **5–17 pixel (<0,01%)**, dengan dimensi sama. Selisih kecil berkaitan dengan fokus/hover dan antialiasing; React mempertahankan tombol yang fokus ketika state berubah. Contact sheet dan tampilan mobile diperiksa secara visual. Kesamaan seluruh halaman tidak diklaim karena kontrol edit/dialog lanjutan belum termasuk UI baca yang belum aktif ini.

Artefak berada di `stage-10/`: capture-results.json, visual-comparison.json, contact-sheet.jpg, screenshot, smoke-results.json, playwright-results.txt dan browser-recheck-results.txt. Skrip pembanding menyimpan gambar diff untuk empat pasangan yang berbeda.

## Batas verifikasi dan operasional

Integrasi PostgreSQL terpisah dilewati karena `SINERGI_TEST_DATABASE_URL` tidak tersedia. Login valid dengan password akun asli, semua variasi dataset produksi dan ketersediaan tile eksternal tidak diverifikasi melalui suite mock. Database asli tidak dipakai untuk pengujian operasi tulis.

Vite kode terbaru di port 5173 menggunakan backend Docker port 5001. Frontend Docker port 5174 masih image sebelum tahap 7; tidak ada rebuild/deployment Docker otomatis. Tidak ada push, merge atau deployment. Penghapusan lokal `.env.docker.example`, folder pengguna `docs/figures/`, rahasia dan backup tetap di luar checkpoint migrasi.

Tahap berikutnya: **11 — Detail dan edit aset di peta**, hanya setelah permintaan baru pengguna.
