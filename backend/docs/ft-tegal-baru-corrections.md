# FT Tegal Baru — koreksi 14 September 2026

Fakta pengguna berada di `shared/facility-corrections.mjs` dan dipakai oleh
regenerasi engine serta adapter diagram untuk dataset aktif yang sudah tersimpan.
Metadata geometri sumber tidak diubah. Relasi koreksi memiliki provenance dan
bukti konfirmasi terpisah; penamaan ambigu tidak dipilih secara sembarang.

- Server terhubung ke JB-01 dan JB-14 (alias JB-014).
- C-08 ke JB-01; C-13 ke JB-02; C-31 ke JB-09.
- JB-02 terhubung langsung ke JB-04.
- Sesuai klarifikasi pengguna: C-32 ke JB-10-EXP, bukan JB-32.
- C-08–C-13, C-15, C-27: indoor.
- JB-08, JB-08.3, JB-09.1/C-33, JB-10.1/C-34,
  JB-13-EXP/C-37–C-40, JB-14/C-44–C-46: di luar tiang.
- Alias kamera dengan nol awal dan akhiran EXP dicocokkan; nomor turunan JB
  tetap berbeda dari JB induknya.

Layout tidak boleh mewariskan frame tiang melalui relasi jaringan atau keluarga
JB jika expectation aset adalah indoor/standalone. Frame non-tiang dipisahkan
menurut komponen yang terhubung, termasuk aset tanpa relasi. Label menampilkan
nomor/nama aset dan tipe kamera dari folder sumber bila tersedia.

Regenerasi berikutnya menyimpan relasi koreksi sebagai relasi terkonfirmasi.
Proyeksi record aktif backend menerapkannya pada respons dataset, graph, dan
trace dataset lama tanpa menulis ulang penyimpanan. Adapter frontend tetap
menangani data lama yang belum melalui proyeksi tersebut.

Diagram memakai struktur kartu seragam mengikuti referensi Figma: server di
atas, frame tiang berisi JB dan kamera, serta frame indoor/non-tiang terpisah.
Kamera indoor dengan satu JB penghubung yang sama digabung dalam frame indoor.
Hierarki frame mengikuti relasi aktual; komponen yang belum tersambung ke server
disusun pada baris berikutnya tanpa menambahkan garis server sintetis. Tampilan
awal menjaga ukuran kartu tetap terbaca; Fit semua menampilkan keseluruhan,
sedangkan Fokus relasi membingkai aset terpilih dan tetangga langsungnya.

JB setingkat menggunakan posisi vertikal bersama meskipun tinggi frame berbeda.
Frame endpoint indoor ditempatkan di samping frame JB asal tanpa menjadi bagian
dari tiang. Frame tiang memakai biru muda, indoor ungu muda, non-tiang jingga muda.
Routing ortogonal menghindari kartu dan judul frame. Crossing antargaris diizinkan
agar tidak menambah detour; belokan tidak digambar sebagai junction baru.
Persilangan antarrelasi yang tidak berbagi endpoint diberi line jump; segmen
trunk yang berbagi sumber tidak diberi penanda persilangan palsu. Jarak level
dihitung terpisah per zona agar frame tinggi di zona server tidak memperpanjang
relasi pada komponen lain. Root lebih besar, backbone lebih tebal daripada
cabang, dan kartu menggunakan bayangan ringan di atas latar zona. Root frame
dipaketkan ke matriks lebar-terbatas; komponen terhubung dan komponen terpisah
berbagi baris matriks agar tidak membentuk jurang vertikal atau deretan tak
berujung ke kanan.
Panah penuh mengikuti direction pada graph. Panah kosong hanya menunjukkan
parent-child dari layout dan diberi keterangan terpisah; undirected tidak diubah
menjadi aliran satu arah maupun bukti komunikasi dua arah. Kartu diperbesar,
ikon endpoint memakai skala 1.3, dan frame satelit memakai baris kompak agar
tidak membentuk kolom panjang jika masih ada ruang di sampingnya.
Tes regresi: `backend/tests/facility-corrections.test.js` dan
`frontend/tests/topology-schematic-layout.test.js`.
