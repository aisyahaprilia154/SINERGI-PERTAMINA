# Checklist Manual UI Peta Aset

Perubahan pada checklist ini hanya mencakup antarmuka di luar kanvas peta. Marker, jalur, tata aset adaptif, koordinat, dan geometri peta harus tetap sama dengan baseline aplikasi.

## Sidebar

- [ ] Dataset card dan topology summary mempunyai jarak yang jelas dan tidak bertabrakan.
- [ ] Scrollbar berada pada keseluruhan konten sidebar, bukan hanya daftar network.
- [ ] Scroll dari area dataset, filter, atau daftar network menggerakkan konten sidebar yang sama.
- [ ] Seluruh network dan footer read-only tetap dapat dicapai dengan scroll.
- [ ] Sidebar collapse/open tetap memanggil resize peta.

## Pencarian aset

- [ ] Tinggi search bar tetap 40 px pada state normal dan fokus.
- [ ] Fokus hanya menampilkan satu focus ring pada container search.
- [ ] Ketik minimal dua karakter menampilkan dropdown tanpa menggeser filter kategori.
- [ ] Dropdown mempunyai tinggi yang cukup dan tidak terpotong oleh sidebar.
- [ ] Arrow Down memindahkan fokus ke hasil pertama.
- [ ] Escape menutup hasil dan mengembalikan fokus ke input.
- [ ] Klik hasil membuka drawer, memfokuskan aset, dan memperbarui URL.
- [ ] Ctrl K memfokuskan input pencarian.

## Tracing

- [ ] Tombol Tracing pada toolbar aktif ketika confirmed topology tersedia.
- [ ] Klik Tracing tanpa selected asset menampilkan instruksi “Pilih titik awal”.
- [ ] Klik marker setelah itu memakai aset tersebut sebagai titik awal.
- [ ] Jika topology tidak tersedia, tombol tetap disabled dan alasannya tampil pada tooltip.

## Regresi peta

- [ ] Marker mempunyai visual dan ukuran yang sama dengan baseline.
- [ ] Jalur mempunyai warna, ketebalan, dan opacity yang sama dengan baseline.
- [ ] Fit bounds dan zoom selection sama dengan baseline.
- [ ] Tidak ada perubahan pada koordinat KML/KMZ atau relation source.

## Responsive

- [ ] Tidak ada horizontal scrollbar pada 1366×768, 1536×864, dan 1920×1080.
- [ ] Search dropdown tetap berada di dalam sidebar pada browser zoom 125%.
- [ ] Contextual bar dan toolbar tidak bertabrakan ketika drawer terbuka.
- [ ] Dropdown Lainnya tampil utuh dan tidak terpotong overflow container.
