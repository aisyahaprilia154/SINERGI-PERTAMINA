# Sinkronisasi koreksi Diagram Topologi

Kode dan data mempunyai alur berbeda. GitHub membawa perubahan kode. Koreksi
lokasi fisik, frame, dan relasi diagram berada di backend. KML yang diekspor
dari Peta Aset hanya cocok sebagai data geografis; ia tidak membawa seluruh
koreksi diagram.

`git pull` hanya memperbarui aplikasi. Pada dua instalasi lokal, dataset aktif
masing-masing tetap tersimpan di backend laptopnya. Setelah menerbitkan koreksi,
pengirim perlu mengunduh **paket koreksi terbaru** dari versi aktif dan
mengirimnya secara privat. Penerima menarik kode terbaru, lalu memilih
**Periksa koreksi** dan **Terapkan koreksi** pada paket itu. Jika kedua laptop
belum berbagi titik sinkronisasi yang sama, gunakan paket awal dan alur
penyelarasan di bawah terlebih dahulu. Jika keduanya memakai satu server dan
database yang sama, koreksi aktif sudah sama tanpa bertukar file.

## Dua laptop tanpa server bersama

1. Pilih satu dataset aktif yang akan menjadi titik awal. Di
   `/admin/topology-sync`, klik **Siapkan titik awal** lalu **Unduh paket awal**.
   Langkah ini mempertahankan koreksi yang sudah ada pada saat titik awal
   dibuat.
2. Kirim paket awal terenkripsi kepada rekan melalui kanal privat. Kirim kata
   sandinya lewat kanal berbeda. Rekan mengimpor paket itu pada instalasi
   kosong, memeriksa preview, lalu mengaktifkan versi tersebut. Kedua laptop
   kini memakai identitas aset dan sumber KML/KMZ yang sama.
3. Keduanya boleh mengedit diagram masing-masing. Untuk bertukar hasil, klik
   **Unduh koreksi**, kirim paket, lalu penerima memilih **Periksa koreksi**.
   Koreksi pada objek berbeda dapat digabung. Pada konflik, pilih **Simpan
   lokal** atau **Pakai paket** untuk setiap objek sebelum menerapkan.
4. Setelah impor, muat ulang diagram. Penerima boleh mengekspor lagi; paket
   berikutnya sudah mencakup hasil gabungan. Paket yang sama boleh diperiksa
   ulang tanpa menggandakan perubahan.

Ekspor membandingkan keadaan terbaru dengan titik awal bersama. Karena itu
paket berikutnya dapat memuat koreksi yang pernah dibagikan; penerima akan
menandainya sebagai **sudah diterima**. Bila ada lebih dari 200 perubahan,
unduh semua bagian secara berurutan dan kirim seluruhnya.

Paket koreksi mengacu pada dataset versi dan titik awal yang sama. Bila kedua
laptop telanjur mengimpor KMZ secara terpisah, jangan timpa salah satu dataset:

1. **Keduanya** mengunduh paket awal masing-masing sebagai cadangan. Rekan
   mengirim paket awal miliknya (bukan paket koreksi saja). Paket awal memuat
   koreksi yang sudah ada sebelum titik sinkronisasi disiapkan.
2. Pada laptop penerima, pilih paket awal rekan dan klik **Selaraskan dari
   paket awal rekan**. Sistem memeriksa checksum KMZ serta identitas aset.
   Sumber atau identitas berbeda ditolak tanpa mengubah data. Tinjau perubahan
   dan pilih hasil untuk konflik.
3. Buat draft hasil penyelarasan, buka diagram draft untuk memeriksa frame,
   penempatan, dan garis relasi, lalu **Tinjau publikasi**. Versi aktif tetap
   tersedia sampai draft diterbitkan. Setelah itu, kirim paket koreksi dari
   dataset aktif yang baru ke rekan agar kedua laptop memakai titik awal sama.

Relasi yang memakai aset sama dengan relasi lokal lain harus dibereskan di
diagram dahulu; penyelarasan tidak memilih relasi secara diam-diam. Jalur ini
hanya berlaku jika berkas KMZ dan identitas aset benar-benar sama. Bila KMZ
berbeda, tinjau pemetaan sumber baru secara manual. Paket awal biasa hanya
dapat diimpor ke instalasi yang belum memiliki dataset aktif untuk
dataset/cabang tersebut.

Paket memakai AES-256-GCM dengan kunci turunan `scrypt`, tetapi keamanan juga
bergantung pada kata sandi yang kuat dan kanal pengirimannya. Nama file
`*.sinergi-sync.json` diabaikan Git; jangan mengganti ekstensi lalu
memasukkannya ke repo. Jangan menyimpan kata sandi atau token API di paket.

## Server yang dideploy

Semua pengguna membuka satu lingkungan aplikasi yang memakai satu PostgreSQL
dan penyimpanan file sumber persisten. Dari halaman sinkronisasi, buat draft
dari dataset aktif, lalu buka Diagram Topologi draft. Edit dan paket koreksi
diterapkan pada draft; pembaca umum tetap melihat versi aktif. Buka **Tinjau
publikasi** untuk melihat nilai sebelum dan sesudah, lalu terbitkan. Publikasi
memeriksa ulang revisi draft dan pointer aktif; jika keduanya berubah, ulangi
peninjauan. Versi sebelumnya tetap tersedia untuk rollback melalui alur
administrator.

Di mode produksi (`SINERGI_TOPOLOGY_DRAFT_REQUIRED=true`), koreksi diagram,
mounting, dan relasi pada versi aktif serta impor KML/KMZ dengan opsi aktivasi
otomatis ditolak. Gunakan
opsi impor **simpan sebagai versi untuk ditinjau**. Rilis kode tidak menghapus
database ataupun volume sumber. Backup wajib mencakup **PostgreSQL dan file
sumber**, dengan uji pemulihan berkala. Docker Compose mengikat port aplikasi
ke localhost; gunakan reverse proxy HTTPS serta pengaturan autentikasi dan
akses jaringan yang sesuai sebelum membuka server untuk pengguna lain.
