# Riset Algoritma Pembacaan Relasi Topologi dari KML

Status: rekomendasi teknis berbasis literatur GIS, audit source code, dan
pengukuran KML aktual
Fokus: akurasi relasi aset-kabel pada koordinat yang tidak presisi
Kerahasiaan: seluruh hasil KML disajikan dalam bentuk agregat

## 1. Kesimpulan

Algoritma yang paling tepat untuk data ini bukan nearest-neighbor biasa dan
bukan pula machine learning penuh.

Pendekatan yang disarankan adalah:

> Semantic constrained snapping: bangun kandidat berdasarkan jarak, saring
> berdasarkan makna aset/jalur, nilai menggunakan beberapa bukti, pilih koneksi
> dengan constraint global, lalu validasi hasil graph.

Nearest point hanya digunakan untuk mencari kandidat, bukan menentukan relasi.

Algoritma terdiri atas enam bagian:

1. semantic classification;
2. spatial candidate generation;
3. candidate scoring;
4. constrained connection selection;
5. derived graph construction;
6. graph validation dan accuracy testing.

## 2. Bukti dari KML aktual

### Distribusi jarak

KML memiliki:

- 824 Point;
- 552 LineString;
- 1.104 endpoint LineString.

Jarak endpoint garis ke Point terdekat:

| Indikator | Jarak |
|---|---:|
| Median | 1,04 m |
| Persentil 75 | 1,69 m |
| Persentil 90 | 2,54 m |
| Persentil 95 | 3,23 m |
| Maksimum | 5,66 m |

Artinya radius pencarian 6 meter cukup untuk membentuk candidate set pada data
aktual. Radius tersebut bukan berarti semua kandidat di dalamnya boleh langsung
disambungkan.

### Candidate ambiguity

Jika semua Point diperbolehkan:

| Kondisi dalam radius 6 m | Endpoint |
|---|---:|
| Tidak ada Point | 0 |
| Tepat satu Point | 228 |
| Lebih dari satu Point | 876 |
| Dua kandidat teratas berselisih <= 0,75 m | 449 |

Kesimpulan: nearest Point tanpa semantic filter mempunyai risiko kesalahan
tinggi.

Jika memakai compatibility rule saat ini:

| Kondisi dalam radius 6 m | Endpoint |
|---|---:|
| Tidak ada kandidat kompatibel | 863 |
| Tepat satu kandidat | 231 |
| Lebih dari satu kandidat | 10 |

Kesimpulan: compatibility rule saat ini menurunkan ambiguity, tetapi terlalu
ketat atau bekerja di atas klasifikasi yang belum memadai. Banyak Point masih
berasal dari folder `unmapped` dan KML tidak mempunyai ExtendedData.

## 3. Temuan dari literatur dan implementasi GIS

### Nearest saja tidak cukup

Penelitian map matching menunjukkan bahwa memilih garis terdekat rentan salah
ketika data lokasi mengandung noise. Walaupun penelitian tersebut memakai
urutan GPS, prinsip yang relevan sama: keputusan harus mempertimbangkan
struktur jaringan, bukan jarak lokal saja.

Referensi:

- Newson & Krumm, Hidden Markov Map Matching Through Noise and Sparseness:
  https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/map-matching-ACM-GIS-camera-ready.pdf

HMM tidak langsung cocok untuk kasus ini karena Point aset bukan urutan
pengamatan bergerak. Prinsip global consistency-nya diadopsi melalui graph
constraints.

### Tolerance harus dibatasi

GRASS GIS menyediakan operasi `snap`, `break`, duplicate removal, dan dangle
checking sebagai langkah terpisah. Dokumentasinya memperingatkan bahwa
tolerance yang terlalu besar dapat merusak topologi.

Referensi:

- https://grass.osgeo.org/grass-stable/manuals/v.clean.html

### Point-to-endpoint dan point-to-line adalah aturan berbeda

ArcGIS membedakan:

- Point Must Be Covered By Endpoint Of;
- Point Must Be Covered By Line.

Pembedaan ini relevan karena CCTV dapat berada pada ujung kabel, sementara
junction atau perangkat tertentu dapat menjadi anchor di tengah jalur.

Referensi:

- https://pro.arcgis.com/en/pro-app/3.5/help/editing/geodatabase-topology-rules-for-point-features.htm

### Noding harus robust

JTS membedakan noding dari graph construction. Snap Rounding menghasilkan
linework yang fully noded dengan precision model dan menghindari rounding vertex
secara naif karena dapat mengubah topologi.

Referensi:

- https://locationtech.github.io/jts/javadoc/org/locationtech/jts/noding/snapround/SnapRoundingNoder.html
- https://locationtech.github.io/jts/jts-features.html

### Candidate search harus memakai spatial index

PostGIS `ST_DWithin` menggunakan bounding-box dan spatial index untuk menyaring
candidate sebelum menghitung jarak. `ST_ClosestPoint` dan
`ST_LineLocatePoint` dapat menghasilkan anchor pada LineString.

Referensi:

- https://postgis.net/docs/manual-dev/ST_DWithin.html
- https://postgis.net/docs/manual-3.3/ST_ClosestPoint.html
- https://postgis.net/docs/manual-3.3/ST_LineLocatePoint.html

PostGIS Topology juga memisahkan node, edge, tolerance, splitting, dan topology
validation.

- https://postgis.net/docs/manual-3.5/Topology.html

## 4. Audit algoritma saat ini

### Yang sudah benar

- Source geometry tidak dimutasi.
- Endpoint dan point-on-line diproses terpisah.
- Candidate di luar tolerance ditolak.
- Kandidat dengan jarak hampir sama ditandai ambiguous.
- Compatibility aset-jalur telah tersedia.
- Anchor diurutkan berdasarkan ukuran sepanjang garis.
- Graph tracing menggunakan hasil topology yang sama.
- Bounding box digunakan sebelum pemeriksaan segment intersection.

### Kelemahan utama

#### 1. Candidate dipilih hampir hanya berdasarkan jarak

Setelah lolos compatibility, kandidat terdekat langsung dipakai. Belum ada
penilaian:

- folder sumber;
- style/icon;
- peran endpoint versus inline device;
- arah kabel;
- kesinambungan sudut;
- identitas jaringan;
- constraint degree perangkat;
- konsistensi dengan graph di sekitarnya.

#### 2. Semantic classification terlalu bergantung pada regex

Kategori diturunkan dari kata seperti `cctv`, `jb`, `switch`, `fo`, dan `lan`.
Pada KML aktual, banyak folder belum terpetakan dan tidak ada metadata. Akibatnya
banyak false negative.

#### 3. Persilangan garis otomatis menjadi junction

Kode saat ini membuat virtual junction ketika dua garis compatible
berpotongan. Ini berisiko false positive.

Persilangan geometris tidak selalu merupakan sambungan fisik. Dua kabel dapat
melintas pada level atau tray berbeda. Intersection hanya boleh otomatis
terhubung jika ada bukti tambahan:

- junction asset;
- explicit metadata;
- shared endpoint yang sudah terverifikasi;
- aturan sumber yang disetujui.

Selain kondisi tersebut, intersection harus tetap terpisah.

#### 4. Belum menangani near-miss antar-endpoint garis

Dua LineString dapat bermaksud saling melanjutkan tetapi endpoint-nya berjarak
sedikit dan tidak memiliki Point aset di antaranya. Algoritma saat ini terutama
mencari endpoint-ke-Point, bukan endpoint-ke-endpoint line.

#### 5. Belum ada duplicate dan overlap cleaning

Garis duplikat atau overlap dapat menghasilkan edge ganda dan jalur semu.

#### 6. Belum ada global connection constraint

Setiap endpoint diselesaikan secara lokal. Padahal keputusan satu endpoint dapat
membatasi keputusan lain.

#### 7. Intersection computation kurang scalable

Perbandingan line-line dan segment-segment masih berlapis. Spatial index atau
robust topology engine diperlukan untuk dataset lebih besar.

#### 8. Belum ada pengukuran akurasi terhadap ground truth

Jumlah edge yang berhasil dibuat bukan bukti akurasi. Diperlukan sampel koneksi
yang diverifikasi manusia.

## 5. Algoritma target

## Tahap A - semantic classification

Setiap source feature mendapat:

```text
site_id
object_role
network_family
asset_type
source_folder_path
source_style_id
```

### Object role

- `device_node`
- `cable_path`
- `coverage_area`
- `ground_overlay`
- `visual_only`
- `unknown`

### Network family

- `cctv`
- `fiber_optic`
- `lan`
- `infrastructure`
- `unknown`

### Sumber klasifikasi

Urutan bukti:

1. ExtendedData jika tersedia;
2. mapping folder yang sudah disetujui;
3. Placemark name pattern;
4. StyleMap/IconStyle untuk Point;
5. LineStyle color/width untuk LineString;
6. struktur parent folder;
7. fallback `unknown`.

Jangan memaksa `unknown` masuk topology.

Style penting pada KML aktual karena sumber mempunyai banyak Style dan StyleMap.
Style dapat menjadi bukti klasifikasi tambahan, tetapi mapping warna/icon harus
divalidasi satu kali bersama mentor.

## Tahap B - metric spatial normalization

KML tetap disimpan sebagai WGS84 longitude-latitude. Untuk operasi topology:

1. pisahkan data per site;
2. transformasikan ke CRS metrik lokal yang sesuai;
3. hitung distance, projection, dan angle dalam meter;
4. simpan derived anchor terpisah dari source geometry.

Jangan memakai derajat sebagai tolerance.

## Tahap C - linework preparation

Untuk setiap network family:

1. hapus zero-length geometry dari derived copy;
2. tandai exact duplicate;
3. tandai overlap;
4. pisahkan LineString per source feature;
5. ambil start endpoint dan end endpoint;
6. buat spatial index endpoint, segment, dan device Point;
7. jangan union seluruh garis sebelum semantic identity jelas.

Source KML tetap immutable.

## Tahap D - candidate generation

### D1. Endpoint ke device Point

Untuk setiap endpoint kabel:

```text
ST_DWithin(endpoint, compatible_device, 6 meter)
```

Hard gate:

- site sama;
- network family compatible;
- object role `device_node`;
- bukan visual-only;
- distance <= 6 m.

### D2. Point di tengah garis

Untuk device yang boleh berada inline:

1. cari compatible cable dalam radius;
2. hitung projected anchor dengan `ST_ClosestPoint`;
3. hitung posisi sepanjang garis dengan `ST_LineLocatePoint`;
4. bedakan interior anchor dari endpoint anchor;
5. jangan split source geometry.

### D3. Endpoint garis ke endpoint garis

Digunakan untuk kabel yang terputus akibat digitasi:

- network family sama;
- jarak <= tolerance;
- arah segmen mendekati kontinu;
- tidak ada device Point yang seharusnya menjadi penghubung;
- bukan garis duplikat/overlap.

### D4. Line intersection

Default:

```text
intersection != connection
```

Junction dibuat hanya jika:

- ada junction device dekat intersection; atau
- ada explicit rule/metadata; atau
- kedua garis memang bagian dari source path yang sama dan aturan sumber
  menyatakan intersection tersebut connected.

## Tahap E - candidate scoring

Gunakan skor yang dapat dijelaskan:

```text
score =
  distance_score
  + semantic_score
  + source_context_score
  + endpoint_role_score
  + angle_score
  + graph_consistency_score
```

### Distance score

Gunakan fungsi menurun, bukan sekadar batas biner:

```text
distance_score = exp(-(distance²) / (2 × sigma²))
```

`sigma` dikalibrasi dari koneksi yang sudah diverifikasi. Berdasarkan distribusi
awal, 1,5-2 meter dapat menjadi titik awal eksperimen, bukan nilai final.

### Semantic score

Compatibility matrix:

| Path | Device yang diizinkan |
|---|---|
| CCTV cable | CCTV, junction box, NVR, switch terkait |
| Fiber optic | OTB, switch, router/core, junction terkait |
| LAN | switch, AP, server, printer/perangkat terkait |

Incompatible pair langsung ditolak, bukan hanya diberi skor rendah.

### Source context score

Nilai tambah jika:

- berada dalam site yang sama;
- berada pada folder/subtree yang sama;
- mempunyai StyleMap konsisten;
- nama network/path konsisten.

### Endpoint role score

Asset seperti CCTV lebih mungkin berada pada terminal cable. Junction box atau
switch dapat mempunyai beberapa incident edge.

### Angle score

Khusus endpoint-line continuation:

- arah yang lurus/mendekati kontinu mendapat nilai lebih tinggi;
- sambungan yang membutuhkan belokan tidak masuk akal mendapat nilai rendah.

Angle tidak boleh dipakai untuk koneksi Point ke endpoint jika perangkat memang
tidak mempunyai orientasi.

### Graph consistency score

Nilai kandidat berdasarkan efek terhadap graph:

- apakah menghasilkan self-loop;
- apakah degree perangkat tidak masuk akal;
- apakah menggabungkan dua network family;
- apakah menciptakan komponen semu;
- apakah membuat path melompat antar-folder/site.

## Tahap F - constrained selection

Jangan memilih setiap kandidat secara independen.

Gunakan maximum-weight constrained matching:

```text
Maksimalkan total candidate score

dengan constraint:
- satu cable endpoint memilih maksimal satu target;
- target harus compatible;
- kapasitas node mengikuti jenis perangkat;
- dua endpoint cable yang sama tidak boleh menuju node sama kecuali loop valid;
- candidate yang menimbulkan forbidden graph pattern ditolak;
- keputusan manual/explicit relation selalu diprioritaskan.
```

Implementasi awal dapat berupa deterministic greedy selection yang diikuti
constraint validation. Jika konflik masih banyak, gunakan weighted bipartite
b-matching atau integer linear programming.

ML tidak diperlukan sampai tersedia cukup banyak ground-truth label.

## Tahap G - derived graph construction

Setelah koneksi dipilih:

1. letakkan anchor pada line;
2. urutkan anchor berdasarkan measure sepanjang line;
3. bentuk topology segment antar-anchor berurutan;
4. tambahkan short connector dari source Point ke anchor;
5. simpan source geometry tanpa perubahan;
6. bentuk adjacency graph.

Peta geografis dapat menggambar short connector agar jaringan tampak tersambung.
Peta topologi memakai graph hasil tahap ini.

## Tahap H - graph validation

Minimal validation:

- no cross-site edge;
- no incompatible network-family edge;
- no accidental self-loop;
- no duplicate edge;
- no zero-length derived edge;
- device degree sesuai batas/aturan tipe;
- dangling cable dilaporkan;
- isolated device dilaporkan;
- cycles diperiksa sesuai karakter network;
- known root-to-leaf path dapat ditelusuri;
- intersection tanpa junction tidak menjadi koneksi.

Degree rule tidak boleh terlalu kaku sebelum karakter jaringan dikonfirmasi.

## 6. Threshold strategy

Gunakan dua nilai:

### Search radius

```text
6 meter
```

Tujuannya hanya mengumpulkan kandidat. Nilai ini berasal dari maksimum jarak
endpoint ke Point terdekat pada KML aktual, sekitar 5,66 meter.

### Acceptance threshold

Jangan ditentukan berdasarkan jarak saja.

Candidate otomatis diterima hanya jika:

- semantic hard gate lulus;
- score melewati threshold hasil kalibrasi;
- score terbaik terpisah cukup jelas dari kandidat kedua;
- constraint global lulus;
- graph validation lulus.

Sebelum gold set tersedia, lebih aman tidak mengaktifkan auto-accept massal.

## 7. UI tetap sederhana

Kompleksitas algoritma tidak perlu tampil di peta utama.

Pengguna operasional hanya melihat:

- aset;
- kabel;
- jalur yang dipilih;
- topologi.

Admin hanya melihat satu daftar:

```text
Perlu diperiksa
```

Detail skor, jarak, dan bukti tersedia ketika item dibuka, bukan menjadi label
pada seluruh peta.

## 8. Cara membuktikan akurasi

Algoritma tidak dapat disebut akurat hanya karena tampilannya tersambung.

### Gold set

Ambil sampel terstratifikasi:

- endpoint <= 2 m;
- endpoint 2-4 m;
- endpoint 4-6 m;
- satu kandidat;
- beberapa kandidat;
- folder belum terpetakan;
- point-on-line;
- line-line near miss;
- persilangan garis;
- koneksi lintas jenis.

Mentor memberi label koneksi yang benar.

Rekomendasi minimum:

- 200-300 endpoint;
- 20 jalur end-to-end;
- mencakup beberapa network family dan site.

### Pisahkan calibration dan test

- calibration set untuk menentukan weight dan threshold;
- held-out test set yang tidak dipakai saat tuning.

### Metrik

#### Precision

```text
koneksi otomatis yang benar / seluruh koneksi otomatis
```

Ini metrik utama. False connection lebih berbahaya daripada koneksi yang belum
terbentuk.

Target awal yang disarankan:

```text
precision auto-connection >= 99%
```

#### Recall

```text
koneksi benar yang berhasil ditemukan / seluruh koneksi benar
```

Recall rendah masih dapat ditangani dengan review. Precision rendah membuat
topologi menyesatkan.

#### Auto-coverage

Persentase endpoint yang dapat diputuskan otomatis.

#### Path accuracy

Bandingkan hasil trace end-to-end dengan 20 jalur yang sudah diverifikasi.

#### Component accuracy

Pastikan algoritma tidak salah menggabungkan dua jaringan terpisah.

## 9. Rekomendasi implementasi

### Backend

Gunakan PostGIS untuk:

- geometry storage;
- GiST spatial index;
- `ST_DWithin`;
- `ST_ClosestPoint`;
- `ST_LineLocatePoint`;
- robust intersection;
- derived geometry.

Source KML dan derived topology dipisahkan.

### Tabel minimum

```text
source_feature
asset_node
cable_path
connection_candidate
topology_anchor
topology_edge
topology_validation_issue
```

### Worker

Topology generation dijalankan saat import atau saat mapping rule berubah,
bukan dihitung ulang pada setiap pembukaan peta.

### Frontend

Frontend hanya menerima:

- source GeoJSON;
- derived connector GeoJSON;
- topology graph;
- review items.

## 10. Prioritas perubahan pada kode sekarang

1. Nonaktifkan auto-connect pada line intersection tanpa junction evidence.
2. Bangun mapping semantic dari folder + style + nama.
3. Tambahkan endpoint-to-endpoint line candidate.
4. Ganti nearest-distance selection menjadi multi-feature scoring.
5. Tambahkan constraint selection dan graph validation.
6. Gunakan spatial index/robust geometry engine.
7. Buat gold set dan test precision.
8. Baru aktifkan auto-connection setelah precision target tercapai.

## 11. Verdict akhir

Data KML cukup dekat secara geometris untuk topology reconstruction. Hambatan
utama bukan besarnya gap, tetapi ambiguity dan kurangnya semantic metadata.

Algoritma yang akurat harus:

- memakai radius 6 meter hanya untuk mencari kandidat;
- menolak pasangan yang tidak kompatibel;
- tidak menganggap persilangan sebagai sambungan;
- mempertimbangkan beberapa bukti;
- memilih koneksi dengan constraint global;
- memvalidasi graph;
- diuji terhadap ground truth.

Tanpa gold set, tidak ada algoritma yang dapat dijamin akurat hanya dari
geometri. Dengan 200-300 label yang representatif, threshold dan scoring dapat
dikalibrasi dan akurasinya dapat dilaporkan secara objektif.
