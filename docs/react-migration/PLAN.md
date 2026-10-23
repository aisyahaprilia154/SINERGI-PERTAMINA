# Migrasi SINERGI ke React, satu tahap per prompt

## Tujuan dan aturan pengerjaan

Seluruh UI akhirnya memakai **React dengan JavaScript/JSX**, dengan tampilan dan fitur sekarang dipertahankan. Vite, MapLibre, logika dataset, dan mesin layout diagram tetap digunakan.

**Setiap prompt hanya mengerjakan satu tahap.** Setelah implementasi dan verifikasi, laporkan hasil lalu berhenti. Tahap berikutnya dimulai ketika kamu memintanya. Tahap yang belum lolos pemeriksaan harus diperbaiki sebelum lanjut.

Kondisi awal: build frontend berhasil, **340 dari 341 tes lulus**, dan ada perubahan lokal yang belum di-commit.

## Fondasi teknis

- Gunakan `react`, `react-dom`, `@vitejs/plugin-react`, dan React Router dengan `createBrowserRouter`. Tetap gunakan Vite yang ada, tanpa mengganti framework build atau menambahkan SSR.
- Gunakan satu React root, komponen JSX, Context untuk sesi/tema, serta `useState` atau `useReducer` untuk state halaman. Belum membutuhkan Redux atau library UI baru.
- Selama transisi, entrypoint memilih implementasi React untuk halaman yang sudah selesai dan implementasi lama untuk halaman lainnya. Navigasi antarhalaman masih memakai pemuatan dokumen penuh; navigasi SPA diaktifkan pada tahap terakhir.
- React mengelola form, menu, tabel, drawer, dan toolbar. MapLibre serta renderer SVG boleh mengelola isi container khusus melalui `ref`, dengan fungsi pembaruan dan `dispose()` yang jelas. Jangan membungkus seluruh halaman lama lalu menganggapnya selesai dimigrasi.
- Pertahankan endpoint API, payload, token sesi, kunci penyimpanan, parameter URL, dan pemeriksaan revision. Perubahan service hanya untuk mendukung pembatalan request dan lifecycle React jika diperlukan.
- Gunakan Vitest, React Testing Library, dan pengujian browser Playwright untuk UI baru; tes Node yang ada tetap dijalankan terpisah. Pemeriksaan JSX dan React Hooks harus masuk lint.

Pendekatan migrasi bertahap mengikuti [panduan React untuk proyek yang sudah ada](https://react.dev/learn/add-react-to-an-existing-project). Cleanup effect harus benar agar aman saat diuji dengan [StrictMode](https://react.dev/reference/react/StrictMode).

## Urutan tahap

| Tahap | Pekerjaan dalam satu prompt | Kriteria selesai |
|---|---|---|
| **1. Baseline dan checklist** | Catat perubahan lokal, inventaris tujuh halaman beserta interaksinya, ambil screenshot desktop/mobile dan terang/gelap, lalu selesaikan satu tes yang gagal. Periksa hasil markup sebelum memperbaiki ekspektasi kelas CSS. | Semua tes baseline lulus; checklist perilaku dan checkpoint kode tersedia. Perubahan lokal terbaru tercakup. |
| **2. Fondasi React dan pengujian** | Pasang dependency, konfigurasi JSX/HMR, siapkan bootstrap React, routing, loading/error boundary, dan test runner. Implementasi lama masih menjadi jalur aktif. | Build, lint, dan tes lulus; React bisa diuji tanpa mengubah perilaku halaman aktif. |
| **3. Login, sesi, dan penjagaan akses** | Migrasikan login beserta toggle password, loading, dan pesan error. Tambahkan pengelolaan sesi React, pemeriksaan user, redirect, logout, dan heartbeat tunggal. Aktifkan login React. | Login berhasil/gagal, sesi kedaluwarsa, redirect pengguna yang sudah masuk, serta akses Administrator/Viewer tetap sesuai. |
| **4. Komponen bersama** | Buat header, menu akun/admin, logo, tombol tema, layout admin, tabel, kontrol workspace, dan dialog/drawer React. Komponen lama tetap tersedia bagi halaman yang belum dimigrasi. | Tampilan sesuai baseline; keyboard, Escape, fokus, dan menu berdasarkan role bekerja tanpa event ganda. |
| **5. Kelola pengguna** | Migrasikan daftar, pencarian, filter role, tambah/edit pengguna, reset password, status online, dan refresh berkala. | Perlindungan administrator terakhir, draft form, konflik data, dan pencabutan sesi tetap bekerja. Aktifkan halaman React. |
| **6. Versi database** | Migrasikan pemilihan dataset, daftar versi, simpan checkpoint, konfirmasi pemulihan, dan status proses. | Revision tetap diperiksa; versi aktif dikenali; pergantian dataset dan pemulihan berhasil; listener dibersihkan. Aktifkan halaman React. |
| **7. Riwayat dan unggah impor** | Migrasikan riwayat, pencarian/filter, unduhan sumber, drawer unggah, validasi file, progress, dan polling status. | Nama/file draft bertahan saat gagal, tindakan selama unggah sesuai perilaku lama, dan preview yang benar terbuka. Aktifkan halaman React. |
| **8. Preview impor** | Migrasikan tambahan aset, konflik, pilihan endpoint, tampilkan aset lama, hitung ulang, unduh sumber, dan penerapan tambahan. Gunakan adapter MapLibre untuk preview. | Konflik dan revision ditangani; posisi kamera tidak reset karena pembaruan tabel; request/polling/peta berhenti ketika halaman ditinggalkan. Aktifkan halaman React. |
| **9. Pisahkan logika peta** | Ekstrak fungsi pencarian, scope area, seleksi jaringan/aset, URL state, dan transformasi data dari halaman besar menjadi modul yang bisa dipakai React maupun UI lama. | Hasil fungsi tetap sama dan seluruh tes peta lulus. Halaman peta masih menggunakan UI lama. |
| **10. Peta React untuk membaca data** | Buat halaman peta, sidebar, filter, pencarian, pemilihan area/jaringan, kontrol basemap/zoom, legenda, cakupan CCTV, dan tampilan mobile. Hubungkan MapLibre lewat container khusus. | Komponen React lolos pengujian; seleksi dan URL konsisten; pembaruan UI tidak membuat ulang instance peta. Rute aktif masih memakai halaman lama sampai tahap 11 selesai. |
| **11. Detail dan edit aset di peta** | Migrasikan drawer detail, penggantian/penghapusan ikon, pencarian dan perubahan relasi, serta relasi pemasangan. Hubungkan pembaruan data ke peta. | Viewer hanya membaca; Administrator dapat mengedit; error dan revision usang tidak merusak state; pergantian aset mengabaikan respons lama. Aktifkan halaman peta React. |
| **12. Dialog peta dan ekspor** | Migrasikan dialog impor/ekspor dan dialog diagram yang dibuka dari peta, termasuk kontrol dan pencariannya. Pertahankan mesin pembentukan diagram dan ekspor. | Impor menuju preview yang benar; ekspor KML mengikuti pilihan jaringan; ekspor SVG/PNG bekerja; dialog tidak meninggalkan listener atau object URL. |
| **13. Pisahkan logika topologi** | Ekstrak pengelolaan dokumen/draft, seleksi, pencarian, koordinasi layout, dan lifecycle renderer dari halaman topologi besar. Pertahankan aturan graph dan layout. | Tes graph/layout tetap lulus dan hasil diagram sesuai baseline. Halaman topologi masih menggunakan UI lama. |
| **14. Topologi React untuk membaca data** | Buat halaman, toolbar, pilihan fasilitas, panel aset/relasi, pencarian, zoom/pan/fit, dan tampilan loading/error/kosong. Sambungkan renderer lewat adapter terisolasi. | Hasil diagram, seleksi, fokus pencarian, tema, dan viewport sesuai baseline. Rute aktif tetap memakai halaman lama sampai tahap 15 selesai. |
| **15. Edit topologi dan penyimpanan** | Migrasikan drag aset/frame, perpindahan kelompok, rename/hapus frame, perubahan relasi, simpan draft, indikator perubahan, konflik revision, dan ekspor. Pertahankan operasi yang memang tersedia pada baseline. | Posisi dan relasi tersimpan serta terbaca kembali; perubahan belum tersimpan terlindungi; drag/zoom tidak memicu render seluruh UI tiap gerakan. Aktifkan halaman topologi React. |
| **16. Integrasi akhir dan hapus jalur lama** | Aktifkan navigasi SPA, tambahkan penjagaan draft saat navigasi internal, hapus renderer halaman dan binder UI lama yang tidak dipakai, rapikan CSS/import, lalu perbarui README. | Seluruh halaman aktif memakai React; tidak ada jalur halaman vanilla yang tersisa; refresh URL langsung, back/forward, dan build deployment berhasil. |

## Pemeriksaan wajib setiap tahap

- Jalankan build, lint, tes lama, dan tes React yang relevan. Kegagalan tidak boleh disembunyikan dengan menghapus atau melemahkan tes.
- Bandingkan tampilan bagian yang berubah dengan baseline pada desktop/mobile serta tema terang/gelap.
- Uji loading, data kosong, error API, retry, submit berulang, role, dan respons async yang datang setelah pengguna berganti halaman.
- Pastikan timer, polling, listener, renderer, dan worker yang digunakan berhenti saat dilepas. Efek tulis seperti upload, simpan, dan restore harus berasal dari tindakan pengguna.
- Saat tahap 16, jalankan seluruh tes, smoke test browser Administrator/Viewer, dan build Docker frontend. Pertahankan output `dist/client`, worker `dist/server`, proxy `/api`, dan fallback URL langsung.

Pengujian operasi tulis menggunakan API mock atau database uji terpisah.

## Checkpoint dan hasil akhir tiap prompt

Setiap tahap menghasilkan checkpoint Git lokal setelah pemeriksaan lulus, pembaruan checklist migrasi, serta laporan berisi:

1. Bagian yang berubah dan sudah memakai React.
2. Hasil pengujian beserta keterbatasan verifikasi.
3. Bagian yang masih menggunakan implementasi lama.
4. Nomor tahap berikutnya.

Format permintaan berikutnya cukup: **“Kerjakan tahap N dari rencana migrasi React. Kerjakan tahap itu saja, verifikasi, lalu berhenti.”**

Migrasi ini tidak mencakup redesign, TypeScript, perubahan database, penulisan ulang riwayat Git, atau publish otomatis. Push, merge, dan deployment mengikuti permintaan terpisah.