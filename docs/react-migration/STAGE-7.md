# Tahap 7 — Riwayat dan unggah impor React

Tanggal: 24 Oktober 2026. Branch lokal: `react-migration-baseline`.
Checkpoint sebelum implementasi: `3f67af1` (perbaikan kompatibilitas database restore dan build Linux terpisah dari migrasi UI). Tidak ada push, merge, atau deployment.

## Implementasi

`/admin/datasets/import` dan trailing slash kini memakai JSX melalui ImportsRoute, ThemeProvider, SessionProvider, SessionGate Administrator, AdminLayout, DataTable, dan Drawer React. Renderer/binder halaman impor lama tidak dimuat oleh rute ini. Navigasi menuju preview dan halaman lain tetap memuat dokumen penuh; preview masih legacy untuk tahap 8.

Riwayat mempertahankan pemilihan dataset dari URL/session/default lalu dataset pertama, tanggal lokal, jumlah tambahan, label arsip, status di luar data aktif, tautan preview, dan unduhan sumber. Pergantian dataset memfilter riwayat yang sudah dimuat tanpa mengubah URL/storage. Config dan riwayat dimuat bersama; loading, konfigurasi kosong, error, dan retry tersedia.

Sesuai rencana tahap 7, pencarian nama impor/nama file dan filter status ditambahkan secara lokal. Baseline lama belum memiliki kedua kontrol ini. Toolbar baru menjadi perubahan tampilan yang disengaja; seluruh tabel dan header lama dipertahankan.

Form mempertahankan nama asli (termasuk spasi), required/maxLength 180, file KML/KMZ tanpa membedakan huruf besar, validasi file tidak kosong dan batas ukuran dari API, serta multipart datasetId/versionName/file. Draft nama dan objek File bertahan ketika validasi, jaringan, unggah, atau pemrosesan gagal. Escape/backdrop/Batal memerlukan konfirmasi pada draft kotor; melanjutkan mengisi mengembalikan fokus ke nama. Membuang draft membersihkan field dan pesan. Beforeunload melindungi draft atau unggah aktif, lalu dilepas saat unmount dan dinonaktifkan pada navigasi sukses ke preview.

Submit menggunakan pengunci ref sebelum render berikutnya. Saat unggah/pemrosesan, form, tombol tutup, dan pilihan dataset terkunci. XHR melaporkan persentase atau progress tanpa ukuran total. StatusUrl dipoll langsung lalu setiap 1200 ms; ready membuka preview menggunakan importId dari respons unggah, bukan ID dari URL job. Failed menampilkan pesan dan mempertahankan draft untuk retry.

useImports mempunyai owner lifecycle per mount: config/history, XHR, polling request/timer dan unduhan menerima AbortSignal; pagehide/StrictMode cleanup/unmount membatalkan pekerjaan. Respons terlambat diabaikan. Object URL unduhan dibersihkan setelah 1000 ms atau segera ketika owner dilepas. Tidak ada worker atau interval baru. Respons 401/403 menghapus sesi dan mengalihkan ke login; Viewer ditolak sebelum riwayat admin dimuat.

Service upload tetap kompatibel dengan pemanggil lama, menolak signal yang sudah aborted sebelum membuat XHR, menyelesaikan promise sekali, dan melepas listener abort sesudah selesai. Service unduhan memeriksa signal sesudah fetch/blob dan meneruskan HTTP status untuk penjagaan sesi. Endpoint, token, payload, storage key, kontrak preview, serta revision tidak berubah; tahap ini tidak menerapkan tambahan aset.

## Verifikasi

**Status: tahap 7 selesai; pemeriksaan wajib lulus. Checkpoint Git lokal dibuat setelah verifikasi. Tahap 8 belum dimulai.**

| Pemeriksaan | Hasil |
| --- | --- |
| Tes Node frontend lama | 336 lulus |
| Vitest/React Testing Library | 87 lulus, termasuk 14 kasus impor baru |
| Tes backend | 77 lulus, 1 integrasi PostgreSQL dilewati |
| Lint root/frontend/backend | Lulus, termasuk JSX/React Hooks |
| Build frontend/backend | Lulus; dist/client, dist/server, manifest 34 source files |
| Visual | 32 screenshot halaman + 32 potongan; 16 perbandingan, diperiksa desktop/mobile dan terang/gelap |
| Playwright tahap 7 | 5/5 lulus: riwayat/filter, draft/busy, polling/preview, unduhan, dan penolakan Viewer |
| Regresi browser | 39/39 lulus dalam satu run (1,5 menit), Chromium Headless Shell 156.0.8078.4 |
| Smoke baseline | 10/10 kelompok lulus; tanpa page error atau endpoint tak dikenal; semua API dimock |

Tes React mencakup filter dataset/search/status, kosong/error/retry, validasi file, draft dan discard/fokus, multipart/Bearer, submit ganda, progress, beforeunload/busy, pemrosesan gagal/ready, ID preview dari respons unggah, interval polling 1200 ms, abort XHR/status/config/history/download, pagehide/unmount, respons terlambat, sesi 401/403 dan revoke object URL.

Artefak visual: stage-7/, capture-imports.cjs, compare-imports.py. Capture memakai fixture API yang sama bagi renderer legacy yang tidak diubah dan React, font asli, desktop 1440×900/mobile 390×844, terang/gelap. Empat keadaan (daftar, drawer, konfirmasi buang draft, kosong) menghasilkan 32 screenshot halaman; 32 potongan header/tabel/panel menghasilkan 16 pasangan perbandingan. Header dan tabel identik pada semua mode; panel konfirmasi identik pada ambang RGB >12. Panel form berbeda 39–53 pixel (kurang dari 0,02% luas panel), termasuk rendering fokus/shadow; contact sheet dan tampilan mobile diperiksa. Halaman penuh memang berbeda karena toolbar pencarian/filter; kontrol baru tidak disembunyikan untuk perbandingan.

Tes awal browser mengoreksi fixture penghitung POST agar mengecualikan heartbeat, serta ekspektasi redirect Viewer mengikuti kontrak `/map` yang sudah ada. Tidak ada assertion perilaku yang dihapus atau timeout dinaikkan. Run awal terhambat saat memori hampir penuh, dan Edge tetap mengalami timeout startup/pemuatan halaman setelah pengguna menutup aplikasi lain. Dugaan race pada seed sesi/intersepsi font sempat dicoba, tetapi perubahan itu dikembalikan karena tidak menyelesaikan hambatan. Cache Vite dibangun ulang. Chromium standar yang diunduh gagal start dengan kesalahan Windows side-by-side; event log menyebut dependent assembly versi browser. Chromium Headless Shell dari distribusi Playwright yang sama dapat berjalan dan meluluskan seluruh 39 kasus tanpa perubahan kode atau tes tambahan. Karena itu timeout awal tidak dapat diatribusikan hanya pada RAM. Label proyek CLI masih `desktop-edge`, tetapi runtime final dipilih eksplisit melalui BASELINE_BROWSER_CHANNEL.

Reproduksi browser pada PowerShell (Vite aktif di port 5173):

```powershell
$env:BASELINE_BROWSER_CHANNEL = 'chromium-headless-shell'
node frontend/node_modules/playwright/cli.js install chromium --only-shell
node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.config.js
$env:NODE_PATH = (Join-Path (Get-Location) 'frontend/node_modules')
$env:BASELINE_OUTPUT_DIR = (Join-Path (Get-Location) 'docs/react-migration/stage-7')
node docs/react-migration/smoke-baseline.cjs
```

Gunakan Node bundled 24.19.0 atau versi yang memenuhi engines dependency. Browser diunduh ke cache lokal pengguna; tidak ada dependency/lockfile aplikasi yang berubah. Capture visual sebelumnya tetap menggunakan Edge dan disimpan sebagai referensi; pengujian perilaku final menggunakan Headless Shell. Kesalahan instalasi Chrome standar tidak diatasi dengan mengubah kebijakan keamanan atau konfigurasi Windows.

Docker Desktop dihentikan sementara untuk mengurangi tekanan memori lalu dijalankan kembali tanpa menghapus container/volume. Pengujian browser tetap memakai mock. Tidak ada perubahan pengaturan RAM/WSL, layanan Oracle/SQL Server, atau penutupan aplikasi pengguna secara paksa.

## Batas verifikasi dan kelanjutan

Seluruh operasi tulis UI menggunakan intersepsi API mock, tanpa mengunggah ke database operasional. Tes integrasi PostgreSQL terpisah masih dilewati jika SINERGI_TEST_DATABASE_URL belum tersedia. Membatalkan request browser mencegah respons usang mengubah UI; transaksi yang sudah diterima server dapat tetap berjalan. Docker frontend pada port 5174 masih memakai image sebelum tahap 7; Vite port 5173 memakai kode terbaru dan proxy backend Docker port 5001. Tidak ada rebuild/deployment Docker untuk tahap ini. Akun asli dan kredensial tetap sama; login sukses dengan akun asli belum diuji karena kata sandi tidak tersedia.

Empat halaman aktif React: login, Kelola pengguna, Versi database, dan riwayat/unggah impor. Preview impor, peta, dan topologi masih legacy. Renderer impor lama dipertahankan bagi tes/regresi; penghapusan menyeluruh pada tahap 16.

Tahap berikutnya **8 — Preview impor**, hanya setelah diminta. Folder pengguna docs/figures/, penghapusan lokal .env.docker.example, konfigurasi rahasia, serta backup database tidak diubah atau dimasukkan checkpoint tahap 7.
