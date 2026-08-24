# Konsep Verified Compound Topology

## Tujuan

Diagram topologi harus menggabungkan tiga informasi utama dalam satu visual:

1. Struktur fisik pemasangan aset.
2. Wiring jaringan yang benar-benar terkonfirmasi.
3. Tingkat keakuratan setiap relasi.

Setiap aset harus tetap tercatat, setiap relasi harus dapat dilacak, dan setiap garis harus memiliki arti yang jelas.

## 1. Struktur Visual Utama

Tiang menjadi **container fisik**, bukan node jaringan.

```text
                                [ CORE / SERVER ]
                                        │
                ┌───────────────────────┴───────────────────────┐
                │                                               │
      ┌──── TIANG T-018 · 3 ASET ────┐          ┌── TIANG T-017 · 2 ASET ──┐
      │                               │          │                           │
      │  [ JB-18.1-WP ]               │          │  [ JB-17.1-WP ]            │
      │       │                       │          │       │                    │
      │       ├── [ C-018 ]           │          │       └── [ C-017 ]        │
      │       └── [ C-043 ]           │          │                            │
      └───────────────────────────────┘          └────────────────────────────┘
```

Makna visual:

- Panel tiang menunjukkan hubungan fisik.
- Garis antar-JB dan CCTV menunjukkan hubungan jaringan.
- Tiang tidak dianggap sebagai endpoint kabel.
- CCTV tetap tercatat sebagai aset terpasang.
- JB dapat menjadi hub lokal apabila memang memiliki relasi jaringan ke CCTV.
- Panel tiang tidak menggunakan bubble besar karena bubble mudah disalahartikan sebagai area jangkauan.

## 2. Tiga Lapisan Informasi

### Lapisan fisik

Menjawab pertanyaan: **aset ini dipasang pada tiang mana?**

Sumber data hanya berasal dari relasi `mounted_on`.

Representasi visual:

- Panel/container tiang.
- Label tiang.
- Daftar JB dan kamera yang terpasang.
- Indikator jumlah aset terpasang.

### Lapisan jaringan

Menjawab pertanyaan: **aset ini benar-benar terhubung ke aset mana?**

Sumber data hanya berasal dari edge topology yang berstatus terkonfirmasi.

Representasi visual:

- Garis solid untuk koneksi valid.
- Port atau titik koneksi pada kartu aset.
- Label keluarga jaringan seperti CCTV, LAN, atau fiber optic.
- Routing siku 90 derajat agar garis tidak menabrak kartu.

### Lapisan keakuratan

Menjawab pertanyaan: **seberapa yakin sistem terhadap relasi tersebut?**

| Status | Makna | Visual |
|---|---|---|
| Terkonfirmasi | Relasi operasional yang sah | Garis solid biru |
| Inferensi otomatis | Relasi hasil pemrosesan sistem | Badge atau garis khusus |
| Saran | Kandidat yang belum disahkan | Garis amber putus-putus |
| Belum terhubung | Belum memiliki relasi valid | Border merah putus-putus |
| Perlu verifikasi | Memiliki interpretasi yang ambigu | Badge peringatan |

Relasi fisik dan relasi jaringan tidak boleh menggunakan status yang sama karena sumber bukti dan tingkat kepercayaannya berbeda.

## 3. Aturan Keakuratan

Sistem wajib menerapkan aturan berikut:

- Aset tidak boleh hilang dari diagram.
- Satu aset hanya boleh memiliki satu tiang induk.
- Satu aset tidak boleh masuk ke dua group tiang.
- Tiang tidak boleh menjadi endpoint kabel jaringan.
- Garis jaringan hanya boleh menghubungkan aset yang memiliki edge terkonfirmasi.
- Kedekatan lokasi tidak boleh otomatis dianggap sebagai koneksi jaringan.
- Relasi fisik boleh menggunakan radius, kecocokan nomor, atau kesamaan fasilitas.
- Jika dua tiang sama-sama mungkin, relasi diberi status ambigu.
- Relasi manual administrator selalu mengalahkan inferensi otomatis.

### Audit kelengkapan area

Untuk setiap area, sistem membandingkan:

```text
asset sumber       = asset yang tergambar
edge sumber        = edge yang memiliki jalur visual
asset mounted_on   = asset yang tampil di group tiang
```

Jika salah satu hasil tidak sama, diagram dianggap belum lengkap.

## 4. Layout Bergaya Packet Tracer

Struktur visual dibuat bertingkat:

1. Core atau perangkat dengan koneksi terbesar berada di bagian atas.
2. Jalur jaringan dibagi menjadi lane.
3. Group tiang disusun dalam grid.
4. JB menjadi pusat koneksi lokal.
5. CCTV ditempatkan sebagai endpoint.
6. Aset tanpa relasi ditempatkan pada area khusus.
7. Koneksi lintas area menggunakan gateway visual.

Layout menggunakan:

- Compound node.
- Routing ortogonal 90 derajat.
- Port koneksi.
- Jalur khusus untuk setiap edge.
- Jarak minimum antar-kartu.
- Collision detection untuk node, panel, dan label.
- Obstacle routing agar edge tidak melewati blok tiang lain.

Dengan aturan tersebut, garis tidak memotong banyak kartu atau berjalan acak melewati seluruh canvas.

## 5. Keterbacaan Adaptif

Informasi tidak perlu dipaksa tampil pada tingkat detail yang sama di semua skala. Namun aset tidak boleh dihilangkan dari model maupun audit.

### Mode ringkasan

Menampilkan:

- Core.
- Group tiang.
- Jumlah aset.
- Jumlah koneksi.
- Status group.

### Mode standar

Menampilkan:

- Nama tiang.
- JB.
- CCTV utama.
- Koneksi antar-group.

### Mode detail

Menampilkan:

- Seluruh CCTV.
- Tipe aset.
- Status aset.
- Port.
- Jenis jaringan.
- Label edge.
- Sumber relasi.

### Mode fokus

Saat pengguna memilih satu tiang atau JB:

- Aset lain dibuat redup.
- Group yang dipilih diperbesar atau diprioritaskan.
- Semua relasi langsung ditampilkan.
- Panel detail menampilkan daftar aset lengkap.
- Pengguna tetap dapat melihat aset tanpa membaca seluruh diagram.

## 6. Visual Aset

Setiap tipe aset memiliki bentuk dan ikon yang konsisten.

| Tipe aset | Representasi |
|---|---|
| Server/Core | Kartu besar dan dominan |
| JB | Kartu hub atau bentuk diamond |
| CCTV | Kartu kamera atau endpoint |
| Fiber/LAN | Label keluarga jaringan pada edge |
| Tiang | Panel/container dengan header khusus |
| Belum terhubung | Border putus-putus |
| Bermasalah | Badge peringatan |

Warna memiliki arti operasional:

- Biru solid: koneksi jaringan terkonfirmasi.
- Hijau border: hubungan fisik terpasang.
- Amber putus-putus: saran koneksi.
- Merah putus-putus: unresolved atau belum terselesaikan.
- Abu-abu redup: aset berada di luar fokus.

## 7. Interaksi Pengguna

Pengguna dapat:

- Klik tiang untuk membuka group.
- Klik JB untuk melihat CCTV yang terhubung.
- Klik garis untuk melihat detail relasi.
- Mencari `T-018`, `JB-18.1-WP`, atau `C-018`.
- Memfilter CCTV, JB, keluarga jaringan, atau aset bermasalah.
- Mengaktifkan atau menonaktifkan visual group tiang.
- Memilih satu jalur untuk tracing.
- Membuka detail aset tanpa kehilangan posisi diagram.
- Menggunakan keyboard untuk memilih node dan group.

## 8. Export yang Berguna

Export harus menghasilkan artefak yang dapat dibaca, bukan hanya satu canvas raksasa.

Pilihan export yang disarankan:

- Diagram seluruh area.
- Diagram satu group tiang.
- Diagram satu jalur jaringan.
- Mode ringkasan.
- Mode detail.
- SVG untuk kualitas tajam.
- PNG untuk laporan.
- PDF multi-halaman apabila jumlah aset terlalu besar.

Aturan khusus export:

- Export dokumentasi selalu menampilkan seluruh label aset.
- Export tidak mewarisi label `auto` dari viewport.
- Selection atau dimming layar tidak boleh membuat aset hilang dari export.
- Diagram besar dibagi menjadi beberapa section atau halaman jika diperlukan.

## 9. Alur Implementasi

```text
Data sumber
    ↓
Graph relasi terkonfirmasi
    ↓
Physical mounting group
    ↓
Compound layout
    ↓
Orthogonal wiring
    ↓
Completeness audit
    ↓
Diagram interaktif dan export
```

Tahapan implementasi:

1. Tetapkan kontrak data dan validasi kelengkapan.
2. Pisahkan relasi fisik `mounted_on` dari edge jaringan.
3. Bangun compound layout untuk group tiang.
4. Tambahkan routing ortogonal dan collision detection.
5. Buat renderer kartu aset, port, panel, dan legend.
6. Tambahkan mode label adaptif dan mode fokus.
7. Sediakan export ringkasan dan detail.
8. Jalankan pengujian data, layout, renderer, interaksi, dan visual.

## 10. Kriteria Penerimaan

Implementasi dianggap benar apabila:

- Semua aset sumber terwakili di diagram.
- Semua edge terkonfirmasi memiliki jalur visual.
- Semua aset `mounted_on` masuk ke tepat satu group tiang.
- JB dan CCTV pada tiang yang sama terbaca dalam satu panel fisik.
- Tiang tidak muncul sebagai endpoint jaringan.
- Edge tidak memotong kartu atau panel tiang lain.
- Label tidak bertumpuk atau terpotong.
- Mode detail menampilkan ID dan tipe seluruh aset.
- Export menampilkan seluruh label aset.
- Audit kelengkapan menunjukkan jumlah sumber dan jumlah visual yang sama.

## Kesimpulan

Konsep **Verified Compound Topology** membuat diagram tidak hanya menyerupai Packet Tracer, tetapi juga mempertahankan prinsip operasional SINERGI:

- Setiap aset terlihat.
- Setiap relasi dapat dilacak.
- Setiap garis memiliki arti.
- Setiap group tiang sesuai dengan data fisiknya.
- Tingkat keakuratan relasi dapat dibedakan.
- Diagram interaktif dan hasil export tetap dapat dibaca.
