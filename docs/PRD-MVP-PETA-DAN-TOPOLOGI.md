# PRD MVP - SINERGI Peta Aset dan Topologi Jaringan

Versi: usulan 2.0
Status: draft untuk validasi mentor
Fokus: satu vertical slice yang dapat membuktikan value di atas Google Earth

## 1. Ringkasan produk

SINERGI adalah aplikasi web read-only yang mempublikasikan data spasial dari
Google Earth menjadi peta operasional yang lebih mudah dibaca dan graph topologi
yang dapat ditelusuri.

Google Earth tetap menjadi tempat authoring dan koreksi geometri. SINERGI tidak
menyediakan editing geometri pada MVP.

## 2. Sasaran

### Sasaran bisnis

- Mempercepat teknisi menemukan aset dan jalur yang relevan.
- Mengurangi ketergantungan pada penelusuran folder KML secara manual.
- Menunjukkan versi data yang dipercaya.
- Membuat koneksi aset dapat ditelusuri dan diaudit.

### Sasaran pengguna

Dalam satu alur, pengguna dapat:

1. memilih site;
2. mencari atau memilih aset;
3. memahami lokasinya;
4. melihat koneksi langsung;
5. trace upstream/downstream;
6. melihat aset yang mungkin terdampak;
7. mengetahui confidence dan sumber informasi.

## 3. Non-goal

- Menggantikan Google Earth sebagai editor.
- Monitoring real-time.
- Zabbix dan notifikasi.
- Manajemen akun lengkap.
- Menjadi CMDB perusahaan.
- Menghasilkan topologi pasti hanya dari jarak geometri.

## 4. Persona

### User operasional SSC ICT

Butuh menemukan aset dan jalur dengan cepat ketika pemeriksaan atau gangguan.
Tidak perlu memahami struktur KML.

### Administrator data

Butuh mengimpor versi, melihat masalah data, memverifikasi candidate connection,
dan mempublikasikan versi yang layak.

### Mentor/manager

Butuh melihat persebaran aset dan keterhubungan secara ringkas tanpa masuk ke
detail teknis setiap folder.

## 5. Jobs to be done

### JTBD-1 - menemukan aset

Ketika saya menerima referensi Asset ID atau nama perangkat, saya ingin
menemukannya dan fokus ke lokasinya dalam hitungan detik.

### JTBD-2 - memahami jalur

Ketika satu perangkat bermasalah, saya ingin melihat jalur confirmed ke hulu
dan hilir agar pemeriksaan lebih terarah.

### JTBD-3 - memahami dampak

Ketika satu node atau kabel terganggu, saya ingin melihat aset yang mungkin
terdampak berdasarkan graph terverifikasi.

### JTBD-4 - memercayai data

Ketika membuka peta, saya ingin mengetahui versi, waktu publikasi, kualitas, dan
sumber relasi yang saya lihat.

### JTBD-5 - mempublikasikan data

Ketika menerima KML/KMZ baru, saya ingin mengetahui apakah file hanya dapat
dipetakan atau juga layak untuk inventaris dan topologi sebelum mengaktifkannya.

## 6. User journey utama

```text
Pilih site
-> peta memuat extent site
-> pilih preset layer
-> cari aset
-> zoom dan highlight
-> buka detail
-> pilih trace upstream/downstream
-> lihat confirmed path
-> buka schematic
-> lihat version + provenance
```

## 7. Functional requirements

### FR-00 Pemisahan tampilan utama

- Aplikasi menyediakan dua tampilan utama: `Peta Aset` dan `Topologi Cabang`.
- `Peta Aset` menunjukkan lokasi fisik/geografis dan tidak memakai logical
  layout.
- `Topologi Cabang` menunjukkan hubungan logis dan tidak harus mempertahankan
  jarak atau orientasi geografis.
- Pemilihan aset disinkronkan: aset yang dipilih pada satu tampilan dapat
  difokuskan pada tampilan lainnya.
- Kedua tampilan memakai dataset version, Asset ID, dan confirmed relation yang
  sama.

### FR-01 Site scope

- User harus memilih satu site/cabang.
- Peta harus memuat extent site tersebut saja.
- Pemilihan disimpan pada URL agar dapat dibagikan secara internal.

### FR-02 Geographic map

- Peta harus menggunakan geographic projection.
- Renderer target menggunakan MapLibre GL JS atau mesin geographic map yang
  memenuhi kontrak setara; Canvas statis bukan renderer geographic map.
- Mendukung Point, LineString, Polygon, dan overlay gambar yang disetujui.
- Basemap harus dapat dikonfigurasi atau dinonaktifkan.
- Peta tidak boleh menggambar jalan atau nama lokasi fiktif.
- Longitude-latitude canonical menjadi sumber posisi; koordinat layar hanya
  hasil projection renderer.
- Kamera awal melakukan fit ke geographic bounds cabang aktif.

### FR-03 Readability

- Label tampil berdasarkan prioritas dan zoom.
- Aset padat dikelompokkan atau disederhanakan pada zoom jauh.
- Warna bukan satu-satunya pembeda.
- Tersedia preset: CCTV, Fiber Optic, LAN, Infrastruktur, dan Semua.
- Aset yang dipilih selalu berada di atas layer lain dan diberi halo.

### FR-04 Search and filter

- Search: Asset ID, nama, tipe, lokasi.
- Filter: site, kategori, tipe, readiness, dan status topologi.
- Memilih hasil search melakukan zoom-to-feature dan membuka detail.

### FR-05 Asset detail

Detail minimum:

- Asset ID;
- nama dan tipe;
- site;
- layer sumber;
- versi dataset;
- metadata tersedia;
- koneksi langsung;
- status confidence/provenance;
- aksi trace dan buka schematic.

### FR-06 Topology graph

- Relasi eksplisit diterima sebagai confirmed jika referensinya valid.
- Hasil inferensi spasial dibuat sebagai candidate.
- Candidate hanya menjadi confirmed setelah lolos rule atau review.
- Ambiguous dan unresolved tidak boleh digunakan untuk tracing.
- Graph disimpan per dataset version.

### FR-07 Tracing

- User memilih titik awal dan arah/tujuan.
- Sistem mencari path pada confirmed graph.
- Hasil menampilkan urutan aset dan jalur.
- Peta menyorot path dan meredupkan objek lain.
- Jika tidak ada path confirmed, sistem menjelaskan status tanpa menebak.

### FR-08 Logical schematic

- Schematic memakai graph yang sama dengan peta.
- Halaman Topologi Cabang memuat seluruh confirmed graph untuk cabang aktif.
- Seluruh graph boleh dimuat tanpa memaksa seluruh label tampil bersamaan.
- Keterbacaan dikendalikan melalui filter kategori, grouping, zoom-dependent
  labels, collapse/expand, search, focus, dan dimming.
- Tersedia scope selected asset, direct neighbors, current trace, dan seluruh
  cabang.
- Candidate dapat ditampilkan sebagai layer review terpisah dan tidak menjadi
  bagian jalur operasional sebelum dikonfirmasi.
- Layout topology menggunakan layered/hierarchical graph layout dengan
  orthogonal edge routing; ELK.js menjadi pilihan awal dan dapat diganti jika
  engine lain memenuhi kontrak yang sama.
- Perangkat inti/root ditempatkan sebagai anchor layout, perangkat distribusi
  menjadi cabang antara, dan endpoint seperti CCTV menjadi leaf jika struktur
  graph mendukung interpretasi tersebut.
- Connected component yang terpisah dikelompokkan dan diberi status yang jelas.
- Kontrol minimum: kategori jaringan, tipe aset, status relasi, grouping, mode
  label, search, focus, fit-to-screen, zoom, minimap, dan export.
- Memilih kategori default-nya meredupkan konteks lain; pengguna dapat memilih
  mode hide untuk menyembunyikannya sepenuhnya.
- Setiap node dapat dikembalikan ke posisi geographic map.

### FR-09 Import readiness

Admin melihat empat readiness:

- parse;
- map;
- inventory;
- topology.

Setiap readiness menampilkan blocking issue, warning, coverage, dan rekomendasi
tindakan.

### FR-10 Version publication

- Import selalu membuat version baru.
- Version baru tidak aktif otomatis.
- Aktivasi atomik.
- User hanya membaca satu active version per site.
- Rollback tersedia ke version valid sebelumnya.

### FR-11 GroundOverlay

- Parser membaca resource, bounds/quad, rotation, visibility, dan draw order.
- Resource di-deduplicate berdasarkan checksum.
- Overlay eksternal tidak di-fetch otomatis.
- Overlay hanya dirender jika resource aman dan berada dalam source package.

### FR-12 Provenance

Setiap asset, geometry, dan edge dapat ditelusuri ke:

- dataset version;
- source feature;
- metode pembentukan;
- review/verification jika ada.

## 8. Readiness rules

### Parse ready

- KML/KMZ aman dan well-formed.
- Geometri dapat dibaca.
- Resource package tidak melanggar aturan keamanan.

### Map ready

- Site dapat ditentukan.
- Koordinat valid.
- Geometri penting dapat dirender.
- Overlay yang dibutuhkan tersedia atau dinyatakan missing.

### Inventory ready

- Asset ID stabil tersedia untuk asset yang masuk inventaris.
- Kategori dan tipe memenuhi mapping.
- Duplikasi ID tidak ada.
- Metadata minimum memenuhi kontrak.

### Topology ready

- Node dan edge mempunyai stable identity.
- Tidak ada dangling explicit relation.
- Coverage confirmed memenuhi threshold yang disepakati.
- Ambiguous/unresolved ditampilkan terpisah.
- Sample path telah diverifikasi.

## 9. Success metrics

### Outcome

- Minimal 90% peserta uji dapat menemukan aset target tanpa bantuan.
- Median waktu menemukan aset lebih cepat daripada baseline Google Earth.
- Median waktu memahami jalur terpilih lebih cepat daripada baseline.
- 100% trace yang ditampilkan hanya memakai confirmed edge.
- Tidak ada dataset yang dipublikasikan dengan readiness salah klaim.

### Quality

- 100% source feature dipertahankan atau dilaporkan sebagai unsupported.
- 100% Asset ID duplikat dilaporkan.
- 100% ambiguous connection tidak masuk confirmed graph.
- Peta tetap interaktif pada dataset pilot.

### Guardrail

- Tidak ada koordinat atau file sumber dikirim ke layanan pihak ketiga tanpa
  persetujuan.
- Tidak ada resource eksternal dari KML yang di-fetch otomatis.
- Data version aktif tidak berubah jika import gagal.

## 10. Acceptance test utama

1. User memilih satu site dan peta membuka extent yang benar.
2. Asset target ditemukan melalui search.
3. Lokasi asset konsisten dengan Google Earth.
4. Layer dapat dinyalakan/dimatikan tanpa mengubah data.
5. Overlay penting berada pada posisi yang benar.
6. Selected asset mempunyai detail dan provenance.
7. Trace confirmed menghasilkan urutan yang telah diverifikasi.
8. Candidate edge tidak ikut trace.
9. Schematic dan geographic map memakai edge yang sama.
10. KML aktual tanpa metadata tidak ditandai inventory/topology ready.
11. Version invalid tidak dapat diaktifkan.
12. Rollback tidak mencampur entity dari dua version.

## 11. Pertanyaan yang harus divalidasi ke mentor

- Satu unit "site" adalah kantor cabang, fuel terminal, atau area lain?
- Skenario pertama yang harus lebih cepat daripada Google Earth apa?
- Asset ID resmi tersedia di sumber lain atau harus dibuat?
- Apakah nama Placemark sekarang dianggap identitas resmi?
- Siapa yang berwenang mengonfirmasi candidate connection?
- Apakah persilangan kabel berarti sambungan?
- Berapa toleransi posisi yang realistis untuk tiap jenis jaringan?
- GroundOverlay mana yang penting bagi operasi?
- Basemap/provider apa yang diizinkan?
- Apakah data boleh diakses di luar jaringan internal?
