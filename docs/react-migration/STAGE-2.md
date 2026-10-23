# Tahap 2 — fondasi React dan pengujian

Selesai secara lokal pada 23 Oktober 2026 (Asia/Jakarta), di branch `react-migration-baseline`. Checkpoint sebelumnya: `7354ee8`.

## Implementasi

- Dependency React/React DOM 19.3.1, React Router 8.5.0, plugin React Vite 6.1.2, Vitest 5.0.5, Testing Library, ESLint dan Playwright terpasang beserta lockfile.
- Build tetap memakai Vite 8.1. Audit menemukan satu temuan high pada versi lama 8.1.4; patch diperbarui ke **8.1.6** (range `~8.1.6`) dan audit ulang melaporkan **0 vulnerability**. Tidak ada SSR atau perubahan server/API/database.
- `frontend/src/main.js` sekarang memanggil pemilih implementasi di `frontend-bootstrap.js`. Daftar `src/react/routes.js` **masih kosong**; semua rute aplikasi tetap membuka implementasi lama. React dan router tidak dimuat ke halaman legacy melalui jalur ini selama daftar kosong.
- Entry lama dipindahkan utuh ke `src/legacy-main.js`; hash Git sama persis dengan entry tahap 1: `dfd885e491fed794e9ef6c47a8e14e972af8026f`.
- `src/react/bootstrap.jsx` menyediakan satu root, StrictMode, `RouterProvider`, dan `dispose()` idempoten untuk melepas root, router, dan listener. `pagehide` yang menyimpan halaman ke bfcache tidak membongkar root.
- `src/react/router.jsx` memakai `createBrowserRouter`, dengan fallback loader awal, Suspense, route error screen dan component error boundary. Retry memakai anchor yang memuat dokumen penuh.
- Tidak ada Context sesi/tema yang mulai menjalankan heartbeat atau mengubah storage. Integrasi sesi tetap tahap 3; komponen bersama/tema tahap 4. Semua layanan akun/dataset dan kunci penyimpanannya tetap.
- HTML dan komponen percobaan berada di `frontend/e2e/fixtures/`. Hanya dilayani oleh Vite saat development/pengujian; tidak masuk `dist/client`.

## Pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| Tes Node frontend lama | **336/336 lulus**, dijalankan terpisah dari Vitest |
| Vitest + Testing Library | **11/11 lulus**: pemilih legacy/React, rute dinamis, JSX/counter, loader pending, lazy/Suspense, loader/render error, satu root, remount/dispose, cleanup StrictMode/bfcache |
| Playwright Edge | **6/6 lulus**: login lama, halaman JSX terisolasi, navigasi dokumen, loading, dua jenis error, serta Fast Refresh yang mempertahankan state |
| Smoke baseline API mock | **10/10 kelompok lulus**, termasuk role/redirect, validasi file, draft, error/retry dan sesi berakhir |
| Backend Node | **75 lulus, 1 dilewati**: integrasi Postgres memerlukan `SINERGI_TEST_DATABASE_URL` |
| Lint root/frontend/backend | Berhasil. Frontend juga menjalankan ESLint JSX dan aturan React Hooks, tanpa warning |
| Uji negatif lint | Conditional Hook dan JSX tidak valid benar-benar ditolak; lihat `stage-2/lint-check.json` |
| Audit frontend | 0 vulnerability setelah patch Vite 8.1.6 |
| Build frontend/backend | Berhasil. `dist/client/index.html` dan `dist/server/index.js` tersedia; fixture e2e tidak ada dalam build |
| Visual | 28 capture ulang desktop/mobile, light/dark; tidak ada uncaught page error atau API tak dikenal |

Perbandingan visual tidak menyembunyikan piksel. Pada ambang perbedaan kanal >12, 27 gambar tidak menunjukkan perubahan; `topology-desktop-light.png` berbeda 198 piksel (0,01528% area gambar) di teks/kontrol sidebar. Pemeriksaan contact sheet dan crop sebelum/sesudah tidak menunjukkan perubahan tata letak atau isi. Data detail per gambar ada di [visual-comparison.json](stage-2/visual-comparison.json) dan [contact sheet](stage-2/contact-sheet.jpg). Capture resolusi penuh tahap 2 disimpan lokal di `.runtime/react-stage2/`, sementara baseline tahap 1 tetap utuh di Git.

Build masih memberi peringatan ukuran chunk MapLibre >500 kB yang sudah ada. Bundle React dibuat sebagai chunk terpisah yang baru dimuat jika rute React dipilih. Fixture error sengaja memicu console error untuk membuktikan error boundary; itu bukan error pada halaman aplikasi aktif.

## Perintah pengembangan

Jalankan dari `frontend`:

```text
npm run dev
npm run build
npm run lint
npm test
npm run test:legacy
npm run test:react
npm run test:react:watch
npm run test:e2e
```

`npm test` menjalankan tes Node lama lalu Vitest. Pengujian browser tetap memakai perintah terpisah. Playwright menghidupkan Vite di port 5173 atau menggunakan server yang sudah tersedia di luar CI. Browser default Microsoft Edge; bisa diubah melalui `BASELINE_BROWSER_CHANNEL`, dan browser tersebut harus terpasang pada mesin pengujian. Pada CI tanpa Edge, instal browser Playwright lalu pilih channel yang tersedia. Dependensi Playwright kini ada di frontend; skrip baseline di `docs/` dapat menggunakannya dengan `NODE_PATH` menunjuk `frontend/node_modules`.

Gunakan Node yang memenuhi `engines` frontend: `^22.22.2 || ^24.15.0 || >=26.0.0`. Verifikasi tahap ini memakai runtime bundled Node **24.19.0**. Node default mesin 24.13.0 belum memenuhi syarat beberapa dependency jsdom. Tidak ada perubahan instalasi Node global.

Capture ulang ke lokasi lain dapat menggunakan `BASELINE_OUTPUT_DIR`; jangan menimpa baseline tahap 1 ketika membandingkan tahap berikutnya.

## Batas verifikasi dan langkah berikutnya

Browser memakai fixture/API mock dan tidak terhubung ke database operasional. Integrasi PostgreSQL hidup, Docker, dataset besar dan basemap eksternal belum diuji tahap ini. Belum ada fitur login, peta atau topologi yang dimigrasikan ke React, sehingga operasi tulis dan penanganan request halaman tersebut tetap pada implementasi lama.

Tahap berikutnya adalah **3 — login, sesi, dan penjagaan akses**. Rute login React baru boleh dimasukkan ke registry setelah UI dan perilaku sesinya lulus pemeriksaan. Selama transisi, navigasi antarhalaman tetap memakai pemuatan dokumen penuh.

Tidak ada push, merge atau deployment pada tahap ini.
