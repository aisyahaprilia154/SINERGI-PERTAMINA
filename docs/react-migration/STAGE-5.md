# Tahap 5 — Kelola pengguna React

Tanggal: 23 Oktober 2026. Branch lokal: `react-migration-baseline`.
Checkpoint sebelum tahap: `85020ca`. Tidak ada push, merge, atau deployment.

## Implementasi

`/admin/users` (termasuk trailing slash dan query context) memakai `UsersRoute` dan satu root React melalui entrypoint transisi. Route memakai ThemeProvider, SessionProvider dengan satu heartbeat bersama, dan SessionGate Administrator. Navigasi masih memuat dokumen penuh.

`UsersPage` merender JSX untuk daftar, pencarian username/email tanpa request baru, filter role, status online, waktu pembaruan, tombol refresh, tambah/edit akun, reset password, error dan notice. Komponen bersama tahap 4 yang digunakan: AdminLayout/AppHeader, DataTable, Drawer, Icon, serta pengelolaan tema. Tidak ada pemanggilan renderer atau binder halaman pengguna lama dari halaman React.

`UserEditor` mempertahankan snapshot akun saat dibuka, username readonly ketika edit, validasi native username/email/password, larangan menurunkan role administrator terakhir, fokus masuk/kembali, focus trap, Escape, konfirmasi buang draft, dan penjagaan beforeunload. Beralih dari edit ke reset password yang memiliki draft memerlukan konfirmasi. Draft dan `expectedUpdatedAt` awal tetap dipertahankan saat refresh latar atau konflik server. Form dan tombol dinonaktifkan saat submit; ref menolak event submit berulang sebelum render berikutnya.

`useUsers` memiliki satu interval 15 detik per mount aktif. Refresh otomatis hanya berjalan ketika dokumen terlihat dan tidak menumpuk request. Request daftar dibatalkan ketika mutasi dimulai agar respons daftar lama tidak menimpa hasil terbaru. Setelah mutasi selesai, daftar dimuat ulang; kegagalan mutasi tidak menghilangkan draft editor. Kegagalan daftar mempertahankan baris dengan status **Belum diperbarui**.

AbortController dan pemeriksaan owner/signal mengabaikan hasil setelah StrictMode cleanup, pagehide, atau unmount. Timer dan visibility listener dilepas bersama owner; request read/write dibatalkan. Respons 401/403 dan pencabutan sesi pengguna saat ini menghentikan pekerjaan halaman, membersihkan sesi lokal, lalu mengalihkan ke login tanpa refresh tambahan memakai token kosong. SessionGate memvalidasi kembali halaman yang kembali dari bfcache dengan reload dokumen, seperti tahap 3.

## Kontrak tetap

- `GET /api/admin/users` dengan `{ users, serverTime }`.
- `POST /api/admin/users` dengan `{ username, email, role, password }`.
- `PATCH /api/admin/users/:id` dengan `{ username, email, role, expectedUpdatedAt }`.
- `POST /api/admin/users/:id/password` dengan `{ password, expectedUpdatedAt }`.
- Bearer token, kunci session storage, role Administrator/Viewer, `sessionsRevoked`, dan parameter URL tetap.
- Service `admin-users-service.js` sudah menerima options/signal sehingga tidak perlu diubah. Backend dan database tidak berubah.
- Tidak ada dependency baru. DataTable hanya mendapat opsi `loadingMessage` agar teks halaman tetap **Memuat pengguna…**; default komponen lain tetap sama.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Tes Node frontend lama | 336 lulus, 0 gagal |
| Vitest/React Testing Library | 55 lulus, termasuk 14 tes khusus pengguna |
| Tes backend | 75 lulus, 1 integrasi PostgreSQL dilewati karena `SINERGI_TEST_DATABASE_URL` belum tersedia |
| Lint root/frontend/backend | Berhasil, termasuk JSX dan React Hooks |
| Build frontend/backend | Berhasil; output `dist/client`, `dist/server`, dan manifest backend tetap |
| Playwright | 26/26 lulus dalam satu run setelah RAM tersedia; mencakup 7 tes pengguna baru dan 19 regresi auth/fondasi/komponen bersama |
| Smoke baseline | 10 kelompok lulus, tanpa uncaught page error atau endpoint tak dikenal; [hasil](stage-5/smoke-results.json) |
| Capture visual | 40 screenshot: 5 keadaan × 4 mode × 2 implementasi |
| Perbandingan visual | Seluruh 24 pasangan memiliki 0 pixel berbeda pada ambang per kanal RGB > 12 |

Keadaan visual: daftar, tambah, edit administrator terakhir, reset password, dan konfirmasi buang draft. Mode: desktop 1440×900/mobile 390×844, terang/gelap. Daftar React dibandingkan dengan baseline tahap 1 dan renderer lama; empat keadaan drawer dibandingkan dengan renderer lama yang sama. Referensi lama diambil lewat intersepsi entrypoint hanya di browser capture; route aplikasi dan source lama tidak diubah. Font asli tetap dimuat untuk capture. Contact sheet dan screenshot mobile diperiksa secara visual.

Artefak: [stage-5/](stage-5/), [hasil perbandingan](stage-5/visual-comparison.json), [contact sheet](stage-5/contact-sheet.jpg). Jalankan ulang dengan Vite aktif, `NODE_PATH=frontend/node_modules`, `node docs/react-migration/capture-users.cjs`, kemudian Python/Pillow `docs/react-migration/compare-users.py`.

Tes komponen meliputi pencarian/filter, empty/error/retry, status online tidak terkonfirmasi, payload dan token asli, submit tunggal, konflik revision/draft, konfirmasi reset, administrator terakhir, sesi dicabut, respons 401/403 read/write, polling visible/hidden, cleanup timer/listener, pembatalan write saat unmount, respons read terlambat, dan gate Viewer sebelum request pengguna. Tes timer hanya memalsukan timer browser; scheduler `setImmediate` React di Node tetap nyata agar tidak ikut dihitung sebagai timer aplikasi.

Percobaan browser saat RAM laptop hampir habis dihentikan dan tidak dihitung sebagai kelulusan. Satu kegagalan awal tes memakai locator label select yang mencakup teks option; locator diperbaiki menjadi role/name combobox tanpa mengubah assertion disabled. Fixture sesi juga diperbaiki agar tidak membuat ulang token yang sudah dicabut pada navigasi ke login. Build pertama mengalami EPERM saat Vite mengunci folder output di Windows; build berhasil setelah Vite dihentikan. Tidak ada assertion yang dihapus, timeout yang dinaikkan, atau perubahan build script untuk menyembunyikan masalah.

## Batas verifikasi dan tahap berikutnya

Seluruh operasi API browser/capture menggunakan mock. PostgreSQL/PostGIS nyata, login akun lama, Docker frontend/backend, dan mutasi database nyata belum diverifikasi; Docker laptop masih dalam proses penyiapan dan database asli berada di komputer lain. Tidak ada akun, aset, atau data operasional yang diubah. Pembatalan request client tidak dianggap membatalkan transaksi yang mungkin sudah diterima server.

Login dan Kelola pengguna aktif memakai React. Versi database, riwayat/unggah, preview impor, peta, dan topologi masih memakai implementasi lama. Renderer pengguna lama dipertahankan untuk tes lama dan referensi transisi; penghapusan jalur legacy menyeluruh tetap tahap 16.

Tahap berikutnya: **6 — Versi database**, hanya setelah diminta. Folder lokal `docs/figures/` milik pengguna tidak diubah dan tidak dimasukkan checkpoint tahap ini.
