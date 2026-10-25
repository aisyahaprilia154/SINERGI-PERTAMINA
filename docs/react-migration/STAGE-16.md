# Tahap 16 — Integrasi akhir dan penghapusan jalur lama

Tanggal: 25 Oktober 2026 (Asia/Jakarta). Dasar kode: `e66de30` (tahap 15). Branch lokal: `react-migration-baseline`.

## Hasil dan cakupan

Tujuh halaman utama — login, kelola pengguna, versi database, riwayat/unggah impor, preview impor, peta dan topologi — sekarang menggunakan React dengan navigasi SPA. Alias `/peta` dan `/topologi`, URL langsung, refresh serta Back/Forward tetap didukung. Satu React root memiliki provider sesi/tema; perpindahan halaman tidak memeriksa sesi atau memasang heartbeat baru tanpa kebutuhan.

Entrypoint tidak lagi mempunyai fallback implementasi vanilla. Halaman dan binder DOM lama dipindahkan ke `frontend/test-support/legacy` untuk menjalankan regresi lama. Folder ini berada di luar sumber produksi dan dikecualikan dari konteks Docker. Mesin MapLibre, SVG, graph/layout, transformasi dataset dan modul domain tetap dipakai; renderer hanya memiliki container khusus melalui adapter. Utilitas persiapan gambar ikon dipisahkan dari binder lama.

Tautan internal, termasuk tautan dalam portal dialog impor, memakai React Router. Tautan unduhan, API, eksternal dan tombol muat ulang tetap mengikuti perilakunya. Penjagaan navigasi mengumpulkan status draft/proses dari halaman dan dialog; penolakan konfirmasi mempertahankan draft. Logout memeriksa draft sebelum mengirim permintaan autentikasi; pembatalan mempertahankan token dan draft, sedangkan persetujuan mengirim satu logout. Riwayat seleksi peta memiliki identitas halaman yang sama agar canvas tidak dibuat ulang. Navigasi halaman eksplisit memiliki identitas baru agar konteks URL dipulihkan dengan benar. Tes mencakup Back di antara dua instance halaman peta, termasuk URL yang sama, tanpa konfirmasi ganda.

CSS dasar dan header dimuat pada bootstrap agar loading/error dan halaman lazy tetap mempunyai gaya. Import header berulang pada stylesheet admin dihapus agar urutan lazy CSS tidak mengubah warna identitas akun. Aturan gelap global untuk body/logo dibatasi ke halaman map/topologi/admin sehingga logout tidak mengubah latar atau logo login. Body/title topologi dipulihkan ketika dilepas. Sesi yang dibersihkan oleh respons tidak sah memberitahukan provider yang bertahan selama SPA; logout menunggu respons sebelum kembali ke login. Tes logout dengan inspector aset terbuka menemukan dropdown tertutup lapisan inspector topologi; z-index header React topologi diperbaiki agar menu dapat diklik biasa, sementara modal yang lebih tinggi tetap berada di atasnya.

Tidak ada redesign, TypeScript, SSR, perubahan kontrak endpoint/payload/revision/token/storage atau database. Output tetap `dist/client` dan worker `dist/server/index.js`; nginx tetap menyediakan proxy `/api` dan fallback URL langsung.

## Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Frontend Node lama | 341/341 lulus |
| Vitest/React Testing Library | 196/196 lulus, 14 file |
| Backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Lint root/frontend/backend, JSX dan Hooks | Lulus |
| Build frontend/worker/backend | Lulus |
| Playwright seluruh suite | 95/95 lulus |
| Smoke Administrator/Viewer | 10/10 lulus |
| Docker build dan HTTP nginx/API | Lulus; sembilan URL langsung dan asset 200, asset hilang 404, API tanpa token 401, health 200 |
| Browser bundle Docker | 15/15 lulus |
| Audit produksi | 166 sumber terjangkau, 0 entrypoint legacy, 73 sumber fondasi identik; 36 modul arsip khusus tes |
| Visual | 44 halaman + 44 potongan; 12 pasangan potongan sebelum/sesudah identik pada threshold kanal RGB 12; 11/12 halaman identik, satu berbeda 117 piksel (0,009%) pada kontrol sidebar peta; empat pasangan SVG identik |

Setelah perbaikan CSS, capture seluruh halaman, smoke 10 kasus, tes Node lama dan build diulang. Penjagaan logout kemudian ditambahkan tanpa perubahan tampilan; suite React 196 kasus, lint JSX/Hooks dan suite browser penuh diulang pada kode final. Build lokal/Docker serta tes SPA/portal pada bundle Docker juga diulang sesudah perubahan logout.

Hasil final dan artefak dicatat dalam `stage-16/verification-results.json` serta log per pemeriksaan. Audit produksi menelusuri import dari entrypoint dan memeriksa bundle agar tidak memuat halaman/binder lama; sumber fondasi yang dipertahankan dibandingkan dengan Git tahap 15.

Regresi meliputi loading/error/retry/kosong, submit tunggal, draft ketika gagal, konflik revision, role, respons terlambat, StrictMode, cleanup request/polling/listener/timer/renderer/object URL, ekspor, serta draft saat navigasi. Efek tulis diuji memakai API mock. Browser memakai Chromium Headless Shell; nama proyek Playwright historis `desktop-edge` tidak berarti tes memakai Microsoft Edge.

RAM host hampir penuh pada beberapa percobaan awal. Sesuai pilihan pengguna, aplikasi lain tetap terbuka. Pemeriksaan akhir memakai satu worker dan batas heap Node untuk tes/lint. Helper React menunggu pembaruan adapter sebelum assertion dan mengirim satu perubahan input nama (juga mewakili paste); assertion validasi/payload dipertahankan dan tes browser tetap menguji keyboard/fokus. Assertion navigasi yang sebelumnya mengharapkan dokumen baru disesuaikan menjadi SPA, dengan pemeriksaan satu dokumen, URL dan komponen tujuan. Kegagalan awal tidak dihitung sebagai hasil final yang lulus. Penambahan kasus logout juga sempat menghasilkan 94/95 karena inspector menutup menu; penyebab CSS diperbaiki, tanpa force-click atau menaikkan timeout, lalu pengujian diulang.

Capture desktop/mobile terang/gelap mencakup tujuh halaman. Login, peta dan topologi juga dibandingkan sebelum/sesudah siklus navigasi dalam dokumen yang sama untuk mendeteksi sisa CSS/body/provider dari halaman lain. Font ikon dimuat sungguhan; SVG topologi ikut dibandingkan. Perbandingan ini menguji konsistensi SPA; baseline visual tahap sebelumnya tetap menjadi referensi historis, bukan klaim bahwa seluruh piksel aplikasi identik dengan tahap 1.

Build Docker diuji dalam image dan container frontend terpisah, memakai port lokal 5186. Smoke browser produksi menggunakan API mock; probe HTTP nyata hanya membaca health, URL frontend, asset dan respons autentikasi tanpa token. Compose operasional tidak dibangun ulang atau diganti.

## Batas verifikasi

Tes integrasi PostgreSQL yang memerlukan `SINERGI_TEST_DATABASE_URL` dilewati karena database uji terpisah belum tersedia. Pengujian login dengan akun database operasional dan operasi tulis terhadap data nyata tidak dijalankan. Kelulusan browser dengan mock tidak membuktikan kredensial/izin jaringan milik komputer lain. Build masih memberi peringatan ukuran chunk MapLibre; tidak menghalangi build dan tidak disembunyikan.

## Checkpoint dan status akhir

Checkpoint lokal dibuat setelah pemeriksaan akhir lulus. Perubahan pengguna pada `.env.docker.example` dan `docs/figures/`, rahasia serta backup tidak disertakan. Tidak ada push, merge atau deployment operasional.

Semua halaman aktif memakai React. Kode lama yang tersisa hanya referensi tes; tidak ada jalur halaman vanilla dalam produksi. Tahap 16 merupakan tahap terakhir dari rencana. Tidak ada tahap berikutnya yang dijalankan otomatis.
