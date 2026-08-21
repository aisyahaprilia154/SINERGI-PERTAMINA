# Rencana Implementasi Diagram Topologi

Status: siap diimplementasikan  
Produk: SINERGI Asset Network  
Fokus: penggabungan halaman Topologi Cabang dan Diagram 2D

## 1. Ringkasan keputusan

- Peta Aset tetap menjadi halaman utama aplikasi.
- Topologi Cabang dan Diagram 2D digabung menjadi satu fitur bernama **Diagram Topologi**.
- Diagram Topologi menggunakan workspace halaman penuh pada route `/topology`.
- Modal Diagram 2D dan topologi geografis lama dipensiunkan agar tidak ada dua visualisasi dengan fungsi tumpang tindih.
- Setiap diagram dibatasi pada satu cabang dan satu dataset aktif. Data dari cabang lain tidak boleh tercampur.
- Pengguna dapat menampilkan seluruh cabang atau memfilter satu area fasilitas.
- Diagram memakai hierarki vertikal dari atas ke bawah.
- Default diagram hanya menggunakan relasi terkonfirmasi, tetapi seluruh aset tanpa relasi tetap ditampilkan pada kelompok terpisah.
- Kandidat koneksi dan endpoint unresolved tersedia sebagai layer opsional khusus administrator.

## 2. Tujuan dan kriteria keberhasilan

Implementasi dianggap berhasil apabila:

1. Pengguna hanya menemukan satu pengalaman untuk melihat topologi logis.
2. Perbedaan antara peta geografis dan diagram logis mudah dipahami.
3. Jalur dari root/core menuju perangkat endpoint dapat dibaca dari atas ke bawah.
4. Seluruh perangkat dalam cakupan tetap dapat ditemukan, termasuk perangkat tanpa relasi.
5. Kabel dan jalur dibaca sebagai koneksi, bukan sebagai kartu perangkat.
6. Memilih aset atau membuka hasil tracing tidak menghilangkan konteks keseluruhan graph.
7. Diagram satu cabang tidak pernah mencampur aset atau relasi dari cabang lain.
8. Kandidat dan unresolved tidak pernah dianggap sebagai relasi operasional terkonfirmasi.

## 3. Arsitektur informasi

### 3.1 Navigasi utama

Navigasi utama terdiri dari:

- **Peta Aset** — proyeksi geografis dan posisi fisik.
- **Diagram Topologi** — proyeksi logis dan hubungan antarperangkat.

Route canonical tetap `/topology`. Alias `/topologi` tetap didukung untuk kompatibilitas tautan lama.

Tombol **Diagram 2D** pada toolbar peta dan drawer detail aset diubah menjadi **Diagram Topologi**. Tombol tersebut menavigasi ke halaman `/topology`, bukan membuka modal.

### 3.2 Batas data

- `branchId` menjadi batas utama diagram.
- `datasetId` menentukan versi data aktif yang digunakan.
- `area` menjadi filter opsional di dalam cabang.
- Tanpa parameter `area`, diagram menampilkan seluruh cabang dan membuat section untuk setiap area.
- Jika dibuka dari Peta Aset, area aktif dipertahankan.
- Perubahan area membersihkan pilihan aset dan tracing yang tidak lagi berada dalam cakupan.

### 3.3 Cakupan URL

Workspace mempertahankan konteks berikut melalui query parameter:

- `datasetId`;
- `branchId`;
- `area`;
- `selectedAssetId`;
- `traceFrom`;
- `traceTo`;
- filter keluarga jaringan;
- state layer presentasi yang aman dibagikan.

Parameter yang tidak valid atau tidak termasuk dalam cabang/dataset aktif harus diabaikan tanpa merusak halaman.

## 4. Konsep visual workspace

Workspace menggunakan kanvas terang agar graph yang padat, label, dan warna media tetap terbaca.

### 4.1 Struktur halaman

- **Header aplikasi**: navigasi Peta Aset dan Diagram Topologi.
- **Panel kiri**: informasi cabang/dataset, filter area, pencarian, filter jaringan, layer status, dan legenda.
- **Kanvas tengah**: diagram statis, zoom, fit, selection, tracing, dan export.
- **Inspector kanan**: detail node/edge, relasi langsung, provenance, tracing, dan aksi buka di peta.
- Inspector ditutup secara default dan terbuka ketika pengguna memilih objek.

### 4.2 Hierarki graph

Urutan setiap section area adalah:

```text
Root / Core / Server Rack
        ↓
Distribusi / Switch / OTB / Main Junction Box
        ↓
Junction Box / perangkat antara
        ↓
Endpoint: CCTV / Access Point / peripheral
```

Aturan layout:

- Graph mengalir dari atas ke bawah.
- Edge memakai routing orthogonal.
- Connected component yang terpisah dibuat sebagai lane terpisah di dalam area yang sama.
- Root terverifikasi selalu ditempatkan pada level pertama component.
- Node pada depth yang sama disusun horizontal dengan jarak konsisten.
- Layout harus deterministic untuk input graph dan filter yang sama.
- Node dan label tidak boleh saling tumpang tindih.

### 4.3 Penentuan root

Urutan sumber root:

1. verified topology root dari endpoint roots;
2. `topologyRole` yang menyatakan root/core;
3. fallback khusus layout berdasarkan prioritas semantic role;
4. degree tertinggi;
5. Asset ID sebagai tie-breaker deterministic.

Fallback hanya menjadi **anchor layout**. UI harus menjelaskan bahwa anchor tersebut bukan root operasional terverifikasi dan tidak boleh menulis perubahan ke confirmed graph.

### 4.4 Representasi node

- Root/core memakai kartu paling menonjol dan label peran yang jelas.
- Perangkat distribusi dan junction memakai kartu ukuran menengah.
- Endpoint memakai kartu lebih ringkas dengan ikon tipe perangkat.
- Node menampilkan minimal nama aset, tipe, dan status relasi.
- Asset ID lengkap tersedia pada inspector dan tooltip agar kartu tidak terlalu lebar.
- Tiang atau mounting relation ditampilkan sebagai bubble berwarna lembut yang
  membungkus perangkat pada tiang yang sama, bukan sebagai edge jaringan.

### 4.5 Representasi edge dan jalur

- Fiber, UTP, Power, dan kabel lain direpresentasikan sebagai edge.
- Warna edge menunjukkan keluarga jaringan atau media.
- Warna harus selalu disertai label, pola, atau metadata agar bukan satu-satunya pembeda.
- Panah hanya ditampilkan jika arah relasi telah terverifikasi.
- Relasi undirected tidak diberi panah.
- Identitas kabel, source geometry, panjang, confidence, dan provenance ditampilkan melalui tooltip atau inspector edge.
- Jalur yang belum mempunyai endpoint aman masuk kelompok **Jalur belum terpetakan**, bukan dibuat menjadi node palsu.

### 4.6 Aset tanpa relasi

- Semua perangkat tanpa relasi tetap ditampilkan.
- Perangkat tersebut ditempatkan pada section **Aset tanpa relasi** di bagian bawah area terkait.
- Gunakan kartu compact yang dikelompokkan berdasarkan tipe aset.
- Tidak boleh dibuat edge sintetis untuk sekadar merapikan layout.
- Jumlah aset terhubung, tanpa relasi, dan jalur belum terpetakan ditampilkan pada ringkasan area/cabang.

### 4.7 Status relasi

Default pengguna operasional:

- confirmed edge ditampilkan;
- candidate, ambiguous, dan unresolved disembunyikan;
- tracing hanya memakai confirmed graph.

Layer administrator:

- kandidat koneksi: garis putus-putus amber;
- ambiguous: garis putus-putus dengan penanda peringatan;
- unresolved: marker merah tanpa dipaksakan menjadi edge;
- inspector menampilkan evidence dan aksi keputusan yang sudah tersedia;
- layer default mati dan hanya muncul untuk role administrator.

## 5. Perilaku interaksi

### 5.1 Memilih aset

Ketika node dipilih:

- graph tetap utuh;
- node dipilih diberi highlight kuat;
- relasi langsung diberi highlight sekunder;
- konteks lain diredupkan, bukan disembunyikan;
- inspector kanan terbuka;
- URL memperbarui `selectedAssetId`;
- tersedia aksi **Buka di Peta Aset** dengan cabang, area, dan Asset ID yang sama.

### 5.2 Tracing

Ketika halaman menerima `traceFrom` dan `traceTo`:

- trace dihitung dari confirmed graph aktif;
- seluruh graph tetap ditampilkan;
- path trace ditebalkan dan konteks lain diredupkan;
- inspector atau ringkasan menampilkan urutan hop, panjang, serta provenance;
- trace stale atau graph revision berubah harus menghasilkan pesan yang jelas dan menawarkan reload;
- candidate dan unresolved tidak boleh ikut dalam path.

### 5.3 Pencarian dan filter

- Pencarian mendukung Asset ID, nama, tipe, lokasi, dan hostname.
- Memilih hasil pencarian memusatkan kanvas, memilih node, dan membuka inspector.
- Filter area benar-benar mengubah scope graph.
- Filter jenis jaringan menggunakan dimming secara default agar konteks tetap terlihat.
- Opsi hide dapat disediakan untuk kebutuhan graph yang sangat padat.
- Aset tanpa relasi tetap dapat ditemukan melalui pencarian.

### 5.4 Zoom dan export

- Sediakan zoom in, zoom out, dan fit tanpa drag node maupun pan berbasis drag.
- Fit menghitung seluruh section dalam scope aktif.
- Export SVG dan PNG menangkap view aktif, legend, serta metadata cabang/dataset.
- Jika layer admin sedang aktif, export boleh menyertakannya tetapi harus mempertahankan penanda non-operasional.

## 6. Perubahan implementasi

### 6.1 Workspace Diagram Topologi

- Repurpose halaman `/topology` menjadi full-page Diagram Topologi.
- Gunakan graph builder, schematic layout, SVG renderer, pencarian, export, dan interaction logic dari Diagram 2D sebagai fondasi.
- Pisahkan logic dialog dari logic workspace agar renderer tidak bergantung pada elemen `<dialog>`.
- Pensiunkan spatial topology renderer yang menggambar posisi asli sumber pada route `/topology`.
- Peta geografis tetap menjadi satu-satunya tempat yang mempertahankan koordinat fisik.

### 6.2 Model graph

- Bangun graph dari confirmed topology projection dalam scope cabang/area.
- Normalisasi perangkat sebagai node dan cable/path sebagai edge metadata.
- Pertahankan stable Asset ID, relation ID, source geometry ID, network family, direction, verification status, dan provenance.
- Bangun indeks connected component, root, depth, degree, aset tanpa relasi, serta jalur belum terpetakan sebelum layout.
- Jangan melakukan topology inference di client.

### 6.3 Layout

- Ubah layout hierarchy menjadi vertikal/top-down.
- Gunakan verified root untuk setiap component jika tersedia.
- Pisahkan area sebagai section utama dan component sebagai lane di dalam section.
- Hitung tinggi lane dari jumlah node per depth dan lebar node aktual.
- Route edge secara orthogonal dan sediakan lane offset untuk parallel edges.
- Cache layout berdasarkan dataset version, branch, area, confirmed edge identity, dan filter yang mengubah struktur.
- Jalankan layout besar melalui worker agar UI tidak membeku.

### 6.4 Navigasi dan kompatibilitas

- Ganti label navigasi menjadi **Diagram Topologi**.
- Ubah semua entry point Diagram 2D menjadi navigasi ke `/topology`.
- Pertahankan `/topologi` sebagai alias.
- Pertahankan konteks dataset, branch, area, selected asset, dan trace pada perpindahan Peta ↔ Diagram.
- Query lama yang hanya relevan dengan spatial topology boleh diabaikan secara aman.

### 6.5 Cleanup

- Hapus pemanggilan modal Diagram 2D setelah seluruh entry point berpindah.
- Hapus state dan kontrol spatial topology yang tidak lagi dipakai.
- Pertahankan fungsi reusable untuk graph building, SVG rendering, export, viewport, dan validation.
- Perbarui dokumentasi UI agar Diagram Topologi disebut sebagai proyeksi logis tunggal.

## 7. State dan failure mode

Workspace harus memiliki state yang jelas untuk:

- loading dataset dan graph;
- cabang atau dataset tidak ditemukan;
- area kosong;
- graph tanpa confirmed edge;
- root belum terverifikasi;
- seluruh aset tanpa relasi;
- trace belum tersedia;
- trace stale;
- topology graph invalid;
- candidate API tidak tersedia bagi pengguna non-admin;
- layout worker gagal;
- export gagal.

Graph tanpa confirmed edge tetap menampilkan aset pada section **Aset tanpa relasi** dan tidak boleh terlihat seperti halaman rusak.

## 8. Rencana pengujian

### 8.1 Unit test

- Scope cabang tidak pernah memasukkan aset atau edge dari cabang lain.
- Filter area hanya menyertakan node, edge, mounting group, dan diagnostik yang relevan.
- Kabel terhubung menjadi edge dan tidak menjadi node perangkat.
- Jalur tanpa endpoint masuk diagnostik belum terpetakan.
- Verified root ditempatkan pada depth nol.
- Fallback anchor deterministic dan tidak mengubah graph sumber.
- Aset tanpa relasi selalu masuk section khusus.
- Selected asset dan trace menghasilkan highlight tanpa menghapus node lain.
- Candidate dan unresolved tidak masuk confirmed graph maupun tracing.

### 8.2 Layout dan renderer test

- Layout mengalir dari atas ke bawah.
- Node rectangle tidak overlap.
- Edge hanya memakai segmen horizontal dan vertikal.
- Parallel edge menggunakan lane berbeda.
- Semua node dan edge berada di dalam final bounds.
- Section area dan component tidak overlap.
- Label penting tetap terbaca pada zoom default.
- Rendering menggunakan status dan network encoding yang konsisten.

### 8.3 Integration test

- Navigasi Peta Aset ke Diagram Topologi mempertahankan dataset, branch, dan area.
- Tombol diagram pada drawer membawa `selectedAssetId` yang benar.
- Hasil tracing dari peta terbuka sebagai highlight pada graph utuh.
- Mengganti area membersihkan pilihan yang berada di luar scope.
- Memilih node dan kembali ke peta mempertahankan Asset ID.
- Admin dapat menyalakan layer candidate/unresolved; pengguna biasa tidak melihat kontrolnya.
- Keputusan candidate menyegarkan graph dan layout dengan graph revision terbaru.

### 8.4 Visual dan accessibility test

- Desktop: panel kiri, kanvas, inspector, toolbar, dan minimap tidak tumpang tindih.
- Tablet: panel kiri dapat diciutkan dan inspector menjadi overlay terbatas.
- Mobile: kontrol utama tetap dapat digunakan dan kanvas dapat dipan/zoom.
- Seluruh kontrol dapat digunakan dengan keyboard.
- Fokus node terlihat jelas.
- Warna bukan satu-satunya indikator status atau jenis relasi.
- Label dan inspector memiliki kontras yang memadai.

### 8.5 Regression test

- Peta Aset tidak berubah secara visual atau perilaku selain nama/tujuan tombol diagram.
- Confirmed edge yang ditampilkan sama dengan graph yang digunakan peta dan tracing.
- SVG/PNG export tetap berfungsi.
- Dataset version dan provenance tetap tampil.
- Route `/topology` dan `/topologi` tetap dapat dibuka dari bookmark lama.

## 9. Acceptance criteria

1. Hanya ada satu fitur bernama Diagram Topologi.
2. Diagram dibuka sebagai halaman penuh, bukan modal.
3. Peta Aset tetap menjadi landing page.
4. Diagram tidak mencampur cabang atau dataset version.
5. Seluruh cabang dapat dilihat dan dapat difilter per area.
6. Hierarki utama adalah root/core → distribusi → junction → endpoint dari atas ke bawah.
7. Perangkat menjadi node dan kabel menjadi edge.
8. Seluruh perangkat tanpa relasi tetap terlihat pada section terpisah tanpa edge sintetis.
9. Pemilihan aset dan tracing mempertahankan graph utuh serta menggunakan highlight/dimming.
10. Candidate dan unresolved hanya muncul melalui layer admin dan tidak ikut tracing.
11. Inspector kanan menyediakan detail, provenance, relasi langsung, tracing, dan tautan kembali ke peta.
12. Diagram dapat dicari, dipan, di-zoom, di-fit, dan diekspor.
13. Layout deterministic, tidak overlap, dan tetap responsif pada dataset pilot.

## 10. Urutan implementasi

1. Ekstrak renderer dan controller Diagram 2D dari dialog menjadi workspace reusable.
2. Bentuk model graph perangkat-as-node dan kabel-as-edge dalam scope cabang/area.
3. Implementasikan layout top-down berbasis area, component, root, dan depth.
4. Repurpose `/topology` untuk merender workspace baru.
5. Tambahkan panel filter, minimap, inspector, selection, dan trace highlight.
6. Tambahkan layer admin candidate/unresolved beserta permission gating.
7. Ubah navigasi dan seluruh entry point Diagram 2D.
8. Pensiunkan modal dan spatial topology lama.
9. Perbarui unit, integration, visual, accessibility, dan regression test.
10. Perbarui dokumentasi produk dan lakukan manual QA pada beberapa cabang serta area dengan bentuk graph berbeda.

## 11. Asumsi

- Cabang merupakan batas dataset operasional utama.
- Area fasilitas merupakan grouping dan filter di dalam cabang.
- Peta geografis tetap menjadi sumber posisi fisik.
- Diagram Topologi tidak harus mempertahankan jarak atau orientasi geografis.
- Backend yang ada sudah menyediakan active dataset, confirmed graph, roots, candidates, unresolved, trace, dan provenance yang diperlukan.
- Tidak diperlukan perubahan schema backend untuk implementasi awal.
- Pengguna operasional bersifat read-only; mutation candidate dibatasi berdasarkan role administrator.
