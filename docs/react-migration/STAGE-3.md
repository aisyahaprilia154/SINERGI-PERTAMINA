# Tahap 3 — login, sesi, dan penjagaan akses

Tanggal: 23 Oktober 2026, Asia/Jakarta. Branch lokal: `react-migration-baseline`. Checkpoint sebelumnya: `fd1b2ed`.

## Yang aktif memakai React

Login `/` sekarang memakai komponen JSX `LoginPage` melalui route lazy React Router. Fallback URL publik yang sebelumnya menampilkan login juga menggunakan komponen tersebut, tanpa mengubah pathname/query pengguna. Registry tidak mengambil alih `/map`, `/topology`, alias `/peta` dan `/topologi`, atau empat rute admin.

Markup, CSS, teks, ikon, atribut input, penyimpanan tema dan logo login mengikuti baseline. Form, toggle password, error, loading, serta tombol tema dikelola React. Tidak ada pembungkus yang menjalankan renderer halaman login lama atau `innerHTML`. Logo JSX saat ini lokal pada login; komponen logo bersama disiapkan pada tahap 4.

Form mempertahankan input saat terjadi error, memfokuskan password, melakukan trim identifier, dan mengunci submit selama request berjalan. Guard ref dan provider mencegah request ganda, termasuk submit programatik berulang. Login hanya dimulai oleh tindakan submit pengguna, bukan effect.

## Sesi dan akses

- `SessionProvider` dan `useSession` menyediakan status checking/anonymous/authenticated/signing-out, user, `signIn` dan `signOut`.
- Sesi tersimpan divalidasi lewat `/api/auth/me`; token tidak langsung dipercaya dari storage. Login publik mengalihkan pengguna yang sudah masuk ke `/map`, tanpa menampilkan form terlebih dahulu.
- `page-access.js` menjadi kebijakan akses bersama untuk entry legacy dan `SessionGate` React. Anonymous diarahkan ke `/`; Viewer tidak dapat memasuki halaman Administrator; Administrator tetap dapat masuk. Alias dan perilaku fallback lama dipertahankan.
- Login berhasil memakai navigasi dokumen `assign('/map')`. Pemulihan sesi dan penolakan akses memakai `replace`, mengikuti perilaku sebelumnya. Navigasi SPA belum diaktifkan.
- Logout React menunggu request logout selesai sebelum pindah dokumen, menyertakan token awal, dan menyatukan aksi logout berulang. Selama menunggu, gate menampilkan loading dan tidak memotong request dengan redirect lebih awal. Tombol logout header legacy tetap memakai service akun yang sama dan telah diuji browser.
- Request login dan `/me` mendukung `AbortSignal`. Provider membatalkan request pada unmount/pagehide. Respons terlambat, termasuk `/me` yang mengembalikan 401 setelah token berubah, tidak mengisi atau menghapus sesi baru.
- Restore halaman React dari bfcache memuat ulang dokumen untuk memeriksa sesi terkini. Listener tersebut dilepas ketika gate dilepas; request login yang sedang ditangguhkan dibatalkan saat pagehide.
- Endpoint, header bearer, payload login, serta kunci `sinergiSessionToken`/`sinergiSessionUser` tidak berubah. Tidak ada perubahan database atau kontrak revision dataset.

Heartbeat memakai satu pengelola dengan pemilik yang dihitung per dokumen: beberapa pemanggil berbagi satu timer, satu set listener, dan satu request yang sedang berjalan. Pemilik terakhir yang melepas sesi menghentikan timer/listener dan membatalkan request. Respons lama tidak mengubah sesi setelah stop atau pergantian token. Interval tetap 30 detik; perilaku reconnect, visibility, bfcache dan perubahan role dipertahankan.

Login publik tidak menjalankan heartbeat; halaman terlindungi tujuan yang menjalankannya. Pada tahap ini halaman tersebut masih legacy. Provider React juga sudah diuji dengan presence aktif untuk pemakaian halaman terlindungi pada tahap selanjutnya.

Inisialisasi tema yang sudah ada sekarang mengembalikan cleanup listener sistem. Login memakai layout effect dan subscription yang dilepas saat unmount, tanpa delegated click listener baru. Context tema dan kontrol tema bersama tetap termasuk tahap 4.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Tes frontend Node lama | **336/336 lulus** |
| Vitest / Testing Library | **28/28 lulus** |
| Playwright Edge | **15/15 lulus** |
| Smoke baseline API mock | **10/10 kelompok lulus** |
| Backend Node | **75 lulus; 1 integrasi PostgreSQL dilewati** |
| Lint root/frontend/backend | Berhasil, termasuk JSX dan Hooks |
| Build frontend/backend | Berhasil; frontend tetap menghasilkan `dist/client` dan `dist/server` |
| Screenshot | **28/28** desktop/mobile dan light/dark; tidak ada uncaught page error atau API tak dikenal |

Vitest mencakup keberhasilan/kegagalan login, input wajib, toggle password, tema/sistem tema, fokus dan draft, submit ganda, pembatalan request, respons terlambat, validasi/expiry sesi, guard role, pemilik heartbeat, cleanup StrictMode, logout menunggu server, serta simulasi suspend/restore bfcache.

Playwright memeriksa alur login React menuju peta legacy dengan dokumen baru; kredensial salah dan jaringan gagal lalu retry; submit pending; sesi yang sudah masuk; logout melalui header lama; anonymous/expired redirect; empat halaman admin ditolak untuk Viewer; Administrator masuk Kelola pengguna; heartbeat satu kali per interval dan expiry; fallback URL dan query; serta enam pemeriksaan fondasi termasuk Fast Refresh.

Visual dibandingkan dengan baseline tahap 1 tanpa masking. Keempat gambar login tidak memiliki perubahan piksel di atas ambang kanal 12. Dari 28 gambar, 27 tidak melewati ambang tersebut; satu gambar topologi desktop terang memiliki selisih 198 piksel (0,01528%) di sidebar, sama seperti tahap 2. Contact sheet sudah diperiksa; tidak ada perubahan isi atau tata letak yang terlihat. Detail ada di [visual-comparison.json](stage-3/visual-comparison.json) dan [contact-sheet.jpg](stage-3/contact-sheet.jpg). Capture penuh tahap ini ada lokal di `.runtime/react-stage3/`; baseline Git tidak ditimpa.

Build pertama yang berjalan bersamaan dengan server pengujian sempat gagal `EPERM` ketika Windows mengganti lokasi folder aset. Build dijalankan ulang setelah server dihentikan dan berhasil; script packaging tidak diubah. Peringatan ukuran chunk MapLibre yang sudah ada tetap muncul.

## Batas dan kelanjutan

Seluruh operasi tulis browser memakai API mock; tidak ada akun atau data operasional yang berubah. Tes integrasi PostgreSQL memerlukan `SINERGI_TEST_DATABASE_URL` dan belum dijalankan. Docker, login ke server nyata, dataset besar dan basemap eksternal belum diverifikasi. Lifecycle bfcache disimulasikan pada tes komponen; pemulihan cache browser nyata belum diverifikasi secara khusus.

Enam halaman yang masih memakai renderer legacy: Kelola pengguna, Versi database, Riwayat/unggah impor, Preview impor, Peta, dan Topologi. Renderer login lama masih disimpan untuk cleanup akhir, tetapi tidak dipilih oleh entrypoint aktif.

Tahap berikutnya adalah **4 — komponen bersama**. Tidak ada redesign, push, merge atau deployment pada tahap 3.
