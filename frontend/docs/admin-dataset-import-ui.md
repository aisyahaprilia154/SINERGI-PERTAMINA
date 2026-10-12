# UI admin SINERGI

Admin memakai header dan token tema yang sama dengan Peta/Diagram. Dropdown akun
Administrator memuat Kelola pengguna, Riwayat import, dan Versi database di atas
Keluar. Navigasi utama hanya Peta/Diagram, tanpa tab admin. CSS dibatasi pada `.admin-body`.

## Pengguna

Tabel memuat pengguna/email, peran, terakhir online, dan tindakan Kelola.
Online menggunakan heartbeat nyata; koneksi gagal ditandai Belum diperbarui.
Tidak ada status Aktif/Nonaktif akun. Administrator/Viewer, reset password,
pencabutan sesi, perlindungan administrator terakhir, dan konflik edit tetap ada.

## Impor dan versi

`/admin/datasets/import` menampilkan halaman Riwayat import dengan konteks dataset.
`/admin/datasets/versions` menampilkan halaman Versi database untuk simpan/pulihkan.
Impor KML/KMZ membuka drawer kanan sekitar 400 px; pada mobile layar penuh.
Drawer mempertahankan draft saat koneksi gagal dan meminta konfirmasi sebelum
membuangnya. Selama unggah/pemrosesan, drawer tidak dapat ditutup; tindakan ini
tidak mengklaim membatalkan job server. Status unggah berasal dari XMLHttpRequest.

Endpoint yang digunakan: `/api/import-config`, `/api/imports`, serta
`/api/datasets/:id/versions`. Token berasal dari sesi akun aplikasi.
Alur tetap unggah → pencocokan → preview → terapkan tambahan. Simpan versi
menyimpan checkpoint; Pulihkan mengembalikan data sesuai versi terpilih setelah
menyimpan keadaan sekarang. Maksimal sepuluh versi unik per dataset.

## Preview

Header memuat nama impor, jumlah tambahan/konflik, dan satu tindakan utama
Terapkan tambahan. Peta, tambahan aset, dan konflik memakai bagian halaman biasa.
Keputusan konflik memperbarui isi yang diperlukan, mempertahankan fokus dan
posisi peta. Data lama sebagai konteks, hitung ulang, dan sumber unduhan tetap ada.

## Verifikasi

Tes DOM/CSS mencakup 1440/1024/768/390 px dalam kedua tema, keyboard/fokus,
draft, kegagalan koneksi, konflik usang, dan fungsi versi. Pemeriksaan ini
bukan verifikasi visual melalui browser; tidak menggunakan computer use.
