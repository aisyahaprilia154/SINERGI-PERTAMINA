# Tahap 8 — Preview impor React

Tanggal: 24 Oktober 2026. Branch lokal `react-migration-baseline`; checkpoint sebelumnya `6cd7d0d`.

## Implementasi

Preview `/admin/datasets/import/:importId/preview` kini memakai JSX dengan SessionGate Administrator, AdminLayout, DataTable dan kontrol React. Tidak memuat renderer/binder preview lama. Tambahan aset, ringkasan, konflik identitas/geometri/endpoint, pilihan aset lama, pilihan endpoint pemasangan/garis, skip/create/match/connect, konteks aset lama, unduhan, hitung ulang, dan penerapan tambahan dipertahankan. React mempertahankan pilihan konflik pada refresh atau error selama kandidatnya masih tersedia. Fokus kembali ke tindakan semula, atau refresh bila konflik yang dipilih sudah hilang.

Hook useImportPreview mengunci tindakan sebelum render berikutnya, membatalkan read/write/download dan timer polling saat unmount/pagehide/StrictMode cleanup, serta mengabaikan respons terlambat. Semua efek tulis berasal dari klik pengguna. Refresh menggunakan POST yang sama lalu GET status setiap 1200 ms; kegagalan proses tidak membuang preview. Apply memakai baseRevision dari preview. HTTP 409 memuat ulang preview/baseline sebelum retry; jika reload gagal, apply dinonaktifkan. HTTP 401/403 menghapus sesi dan mengalihkan ke login. Object URL sumber dibersihkan setelah 1000 ms atau saat dilepas.

createPreviewMapAdapter memiliki container khusus, update(payload) dan dispose(). Signature payload mencegah pembuatan ulang peta pada render tabel/busy/error saja. Bila geometri/konteks benar-benar berubah, surface diganti dengan initialCamera dari getCamera(), mempertahankan pusat, zoom, bearing dan pitch. Import renderer yang selesai setelah dispose diabaikan. MapLibre tetap mengelola isi container dan destroy() membersihkan listener/timer/worker internal. Tidak ada wrapper halaman vanilla atau dangerouslySetInnerHTML.

Fungsi murni previewMapPayload dipindah ke domain/import-preview.js dan diekspor ulang dari modul lama agar tes/konsumen lama tetap kompatibel. Endpoint, token, payload keputusan, storage key dan revision tetap sama. Perbaikan UX terbatas: tombol retry untuk kegagalan membaca preview dan reload setelah konflik revision.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Tes Node frontend | 336 lulus |
| React/Vitest | 97 lulus, termasuk 10 kasus preview/adapter baru |
| Backend | 77 lulus; 1 integrasi PostgreSQL dilewati karena DB uji terpisah belum tersedia |
| Playwright | 43/43 lulus dalam satu run pada Chromium Headless Shell 156, termasuk 4 kasus preview baru |
| Lint root/frontend/backend | Lulus termasuk JSX dan Hooks |
| Smoke baseline | 10/10 kelompok lulus dengan API mock |
| Build frontend/backend | Lulus; dist/client, dist/server dan manifest backend 34 file dipertahankan |

Tes meliputi loading/error/retry/kosong, multipart tahap 7 tetap regresi, keputusan identitas dan endpoint pemasangan, draft pilihan, kontrol busy dan submit tunggal, baseRevision serta 409/reload/retry, refresh/polling gagal, sesi/Viewer, respons lama, abort dan dispose, signature payload, pelestarian kamera, factory map terlambat, unduhan dan navigasi dokumen penuh. Tes browser awal memperbaiki selector combobox yang ambigu dengan checkbox konteks dan memeriksa pathname redirect karena peta memang menulis parameter URL. Assertion perilaku tidak dilemahkan, timeout tidak dinaikkan.

Capture visual disimpan di stage-8/, menggunakan legacy/React dengan fixture identik, desktop/mobile, terang/gelap, dan keadaan ready/konflik/kosong/error. Skrip menangkap query string pada URL entrypoint Vite dan memverifikasi modul renderer yang dimuat agar referensi legacy tidak diam-diam memakai React. Font asli dan vector basemap kosong digunakan; sumber tile eksternal/produksi tidak diuji. Perbedaan error berupa tombol retry React disengaja. Capture awal sebelum pemeriksaan modul diganti oleh capture tervalidasi. Setelah memperbaiki kesalahan encoding pada pemindahan source legacy, 12/12 pasangan header/tabel/konflik identik pada ambang RGB >12. Total 32 screenshot halaman dan 24 potongan komponen; contact sheet diperiksa. Tes Node legacy dan build dijalankan ulang setelah koreksi encoding.

## Batas dan kelanjutan

Operasi tulis diuji memakai API mock; tidak menerapkan, mengubah konflik, atau mengunggah ke database operasional. Abort client bukan jaminan transaksi server dibatalkan. Backend Docker tetap sehat dengan data restore; image frontend Docker port 5174 belum dibangun ulang, kode terbaru di Vite port 5173. Akun asli belum dipakai login sukses karena password tidak tersedia. Peringatan bundle MapLibre besar tetap seperti sebelumnya.

Lima halaman aktif React: login, pengguna, versi, riwayat/unggah dan preview. Peta serta topologi masih legacy. Checkpoint lokal dibuat setelah verifikasi tanpa push/merge/deployment. Folder pengguna docs/figures/, penghapusan .env.docker.example, rahasia dan backup tidak disertakan.

Sesuai instruksi pengguna, lanjut langsung **tahap 9 — Pisahkan logika peta**, lalu tahap 10 setelah tahap 9 lolos. Berhenti setelah tahap 10, tanpa memulai tahap 11.
