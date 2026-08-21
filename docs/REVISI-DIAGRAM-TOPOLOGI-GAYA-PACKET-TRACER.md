# Revisi Diagram Topologi Bergaya Cisco Packet Tracer

Status: siap diimplementasikan  
Jenis dokumen: addendum rencana implementasi  
Dokumen induk: `docs/RENCANA-IMPLEMENTASI-DIAGRAM-TOPOLOGI.md`  
Fokus: memperjelas hubungan perangkat, khususnya koneksi antar-Junction Box

## 1. Latar belakang

Diagram saat ini masih terasa seperti kumpulan aset yang berdiri sendiri. Hubungan antarperangkat, terutama backbone antar-Junction Box (JB), belum menjadi elemen visual utama. Akibatnya, pengguna sulit membaca alur jaringan meskipun sebagian relasi sebenarnya sudah tersedia dalam confirmed graph.

Revisi ini mengarahkan Diagram Topologi menjadi kanvas jaringan yang secara visual menyerupai Cisco Packet Tracer:

- perangkat direpresentasikan sebagai ikon;
- nama aset ditempatkan di bawah ikon;
- hubungan antarperangkat direpresentasikan sebagai kabel/garis;
- jalur JB-ke-JB menjadi backbone yang mudah diikuti;
- CCTV dan endpoint lain terlihat menggantung pada JB yang melayaninya;
- relasi confirmed dan relasi saran dibedakan secara tegas.

Yang ditiru adalah bahasa visual dan kemudahan membaca topologi, bukan fungsi simulasi jaringan Cisco Packet Tracer.

## 2. Temuan baseline data aktif

Pemeriksaan pada dataset aktif `dv-6b012fa0-ec62-495d-9e84-ef7e4d3dd093` menghasilkan baseline berikut:

- 824 topology node;
- 567 confirmed edge;
- 138 confirmed edge JB-ke-JB;
- 408 edge CCTV-ke-JB;
- 266 connected component;
- 189 isolated node;
- 229 Junction Box;
- 430 CCTV;
- 161 tiang;
- 4 server rack.

Graph telah memiliki koneksi antar-JB, tetapi masih terfragmentasi menjadi banyak component. Oleh karena itu, perubahan visual saja tidak cukup untuk membuat semua JB terlihat tersambung. Implementasi harus:

1. menonjolkan confirmed JB-to-JB link yang sudah tersedia;
2. menampilkan candidate/recommended link sebagai saran putus-putus;
3. tetap menandai JB yang benar-benar tidak memiliki evidence koneksi;
4. tidak membuat koneksi palsu di client.

Dataset aktif saat pemeriksaan masih memiliki publication profile `map_only` dan capability topology belum ready. Kondisi ini harus diperlakukan sebagai draft topology.

## 3. Keputusan produk

### 3.1 Bentuk workspace

- Diagram Topologi tetap menjadi halaman penuh pada route `/topology`.
- Peta Aset tetap menjadi landing page dan sumber posisi geografis.
- Setiap diagram dibatasi pada satu cabang dan satu dataset version.
- Pengguna dapat melihat seluruh cabang atau memfilter satu area fasilitas.
- Data antar-cabang tidak boleh digabung pada satu kanvas.

### 3.2 Gaya Packet Tracer

- Node menggunakan **ikon perangkat dengan label nama di bawahnya**, bukan kartu aset besar.
- Link menggunakan **garis lurus** antar-node.
- Auto-layout awal menggunakan hierarchy dari atas ke bawah.
- Posisi node dikunci pada hasil auto-layout agar hierarchy dan jalur selalu
  konsisten untuk semua teknisi.
- Node maupun kanvas tidak dapat di-drag. Navigasi menggunakan pencarian,
  pemilihan area, klik perangkat, scroll, zoom, dan Fit.
- Diagram tidak menampilkan port visual atau nama port.
- Tidak ada simulasi paket, konfigurasi perangkat, atau emulasi jaringan.

### 3.3 Kebijakan relasi

- Confirmed relation menggunakan garis solid.
- Candidate/recommended relation menggunakan garis putus-putus dan label **Saran**.
- Suggested link hanya berasal dari evidence/candidate backend.
- Client tidak boleh membuat nearest-neighbor relation baru.
- Suggested link tidak boleh ikut tracing, impact analysis, atau perhitungan confirmed connectivity.
- JB tanpa confirmed maupun suggested link tetap tampil sebagai disconnected node.

### 3.4 Hak akses dan readiness

- Dataset topology-ready dapat dilihat pengguna operasional dan administrator.
- Dataset `map_only` atau belum topology-ready hanya dapat dilihat administrator sebagai **Draft Diagram Topologi**.
- Administrator melihat layer saran koneksi aktif secara default.
- Pengguna operasional hanya melihat confirmed link.
- Pengguna operasional yang membuka diagram belum siap mendapat state **Diagram belum siap dipublikasikan**, bukan draft graph.

## 4. Target visual

Contoh struktur topologi:

```text
                     ┌─────────────────┐
                     │ Server Rack/Core│
                     └────────┬────────┘
                              │  Fiber (confirmed)
                              │
                         ┌────▼────┐
                         │ Main JB │
                         └─┬───┬───┘
                           │   │
                 ┌─────────┘   └──────────┐
                 │ UTP                    │ Fiber
             ┌───▼───┐                ┌───▼───┐
             │ JB-01 │                │ JB-02 │
             └─┬───┬─┘                └───┬───┘
               │   │                        │
          ┌────▼┐ ┌▼────┐               ┌──▼───┐
          │CCTV1│ │CCTV2│               │CCTV3 │
          └─────┘ └─────┘               └──────┘

                         ┊ Suggested link
                         ┊
                     ┌───▼───┐
                     │ JB-03 │
                     └───────┘
```

Makna visual:

- garis solid: relasi terkonfirmasi;
- garis putus-putus: saran koneksi yang belum operasional;
- node dengan warning: tidak memiliki confirmed maupun suggested link;
- highlight tebal: selected asset atau hasil tracing;
- node redup: konteks di luar selection/trace, tetapi tetap tersedia.

## 5. Hierarki dan auto-layout

### 5.1 Urutan hierarki

Urutan penempatan awal per area:

1. server rack, core, atau verified root;
2. main/distribution JB, switch, atau OTB;
3. backbone JB;
4. extended/access JB;
5. CCTV dan endpoint lain;
6. disconnected device pada section khusus.

### 5.2 Penentuan anchor

Prioritas anchor component:

1. verified topology root;
2. node dengan `topologyRole` root/core;
3. server rack atau core device;
4. JB dengan degree confirmed tertinggi;
5. Asset ID sebagai deterministic tie-breaker.

Fallback hanya menjadi anchor layout. Fallback tidak boleh ditampilkan sebagai verified root dan tidak boleh mengubah graph sumber.

### 5.3 Penempatan component

- Confirmed graph menjadi dasar connected component.
- Component yang mengandung server rack ditempatkan paling atas.
- Component JB yang memiliki suggested link ke backbone ditempatkan dekat target sarannya.
- Component lain ditempatkan pada lane terpisah.
- Disconnected node ditempatkan pada section **Belum Terhubung** di bagian bawah area.
- Area berbeda menggunakan section kanvas yang berbeda.

### 5.4 Layout statis

- Auto-layout dijalankan saat halaman pertama kali dibuka, area berubah, atau
  graph revision berubah.
- Posisi perangkat tidak menjadi alat editing dan tidak dapat dipindahkan.
- Urutan tier selalu dari core, distribusi, akses, lalu endpoint.
- Perubahan filter tidak boleh menghasilkan hierarchy yang ambigu atau edge
  sintetis.

## 6. Representasi perangkat

### 6.1 Node perangkat

Setiap node minimum memiliki:

- ikon berdasarkan asset type;
- nama aset;
- indikator selected/trace;
- indikator disconnected atau suggested-only;
- tooltip ringkas;
- target klik untuk membuka inspector.

Ikon minimum yang dibutuhkan:

- server rack/core;
- Junction Box;
- switch/OTB jika tersedia;
- CCTV;
- tiang atau mounting group;
- perangkat generik untuk tipe yang belum dipetakan.

Asset ID, lokasi, provenance, degree, dan metadata lengkap ditampilkan pada inspector, bukan memenuhi kanvas.

### 6.2 Kabel sebagai link

Fiber, UTP, Power, dan path lain tidak boleh dirender sebagai node perangkat. Data tersebut menjadi metadata link:

- media/network family;
- path asset identity;
- source geometry identity;
- relation type;
- verification status;
- direction jika terverifikasi;
- confidence dan evidence untuk suggested link.

Warna link membedakan media, tetapi warna harus selalu didampingi pola atau label pada legenda.

### 6.3 Tiang dan mounting relation

Tiang bukan hop jaringan kecuali confirmed graph secara eksplisit menyatakannya sebagai perangkat jaringan. Secara default:

- tiang menjadi grouping bubble fisik;
- CCTV dan JB yang terpasang pada tiang tetap menjadi node jaringan;
- mounting relation tidak digambar sebagai kabel jaringan.

Pada kanvas, satu tiang direpresentasikan sebagai bubble bulat/oval berwarna
lembut di belakang perangkat yang terpasang. Label tiang berada di dalam bubble.
Warna bubble hanya membedakan grouping fisik dan tidak menyatakan status.

## 7. Model data UI

Renderer menggunakan dua entitas presentasi utama.

### 7.1 Device node

```js
{
  id,
  assetId,
  name,
  assetType,
  iconType,
  branchId,
  areaId,
  topologyRole,
  connectivityStatus,
  confirmedDegree,
  suggestedDegree,
  isVerifiedRoot,
  isLayoutAnchor,
  position: { x, y }
}
```

`position` hanya milik presentation state dan tidak ditulis ke source asset.

### 7.2 Topology link

```js
{
  id,
  sourceId,
  targetId,
  status: 'confirmed' | 'suggested',
  networkFamily,
  mediaType,
  relationType,
  direction,
  confidence,
  evidence,
  pathAssetIds,
  sourceGeometryIds
}
```

Invariant:

- tracing hanya membaca link dengan `status: 'confirmed'`;
- suggested link tidak meningkatkan confirmed degree;
- semua endpoint link harus berada dalam cabang dan area scope yang sama;
- link tanpa endpoint valid tidak dirender sebagai koneksi.

## 8. Perilaku interaksi

### 8.1 Selection

Ketika node dipilih:

- node mendapat highlight kuat;
- confirmed neighbor dan link langsung mendapat highlight sekunder;
- suggested link terkait tetap menggunakan pola putus-putus;
- konteks lain diredupkan, bukan disembunyikan;
- inspector kanan terbuka;
- URL memperbarui `selectedAssetId`.

### 8.2 Tracing

- Graph utuh tetap terlihat.
- Confirmed path ditebalkan.
- Suggested link tidak boleh menjadi bagian path.
- Inspector menampilkan urutan hop dan provenance.
- Trace stale harus meminta graph dimuat ulang.

### 8.3 Review saran koneksi

Administrator dapat memilih suggested link untuk melihat:

- source dan target;
- score/confidence;
- media dan candidate type;
- distance jika tersedia;
- evidence pembentukan;
- aksi confirm atau reject.

Setelah confirm berhasil:

- graph revision dimuat ulang;
- suggested link diganti confirmed link;
- component dan layout dihitung ulang;
- link dapat digunakan tracing.

## 9. Perubahan implementasi

### 9.1 Graph projection

- Gunakan confirmed topology graph sebagai sumber node dan link operasional.
- Muat candidate/recommended relation untuk layer saran administrator.
- Project cable/path identity menjadi metadata edge.
- Bangun indeks per cabang, area, component, root, depth, confirmed degree, dan suggested degree.
- Jangan menjalankan topology inference baru di browser.

### 9.2 Renderer

- Ganti node card besar menjadi icon-first node.
- Ganti routing orthogonal utama menjadi garis lurus.
- Pisahkan style confirmed, suggested, selected, traced, dimmed, dan disconnected.
- Pastikan link digambar di bawah node.
- Perluas hit target garis tanpa mempertebal tampilan visual.
- Minimap menggunakan versi node/link yang disederhanakan.

### 9.3 Layout controller

- Auto-layout menggunakan hierarchy top-down.
- Backbone confirmed JB-to-JB diprioritaskan sebelum endpoint.
- Suggested link memengaruhi kedekatan component untuk administrator, tetapi tidak mengubah confirmed depth.
- Drag position disimpan pada in-memory workspace state.
- Reset membuang manual position dan menjalankan auto-layout ulang.

### 9.4 Readiness dan role gating

- Periksa capability topology dan publication profile sebelum merender.
- Administrator boleh membuka draft graph dengan warning permanen.
- Pengguna operasional hanya boleh membuka graph yang topology-ready.
- Layer saran dan aksi review hanya dirender jika role mengizinkan.

## 10. Test plan

### 10.1 Graph projection

- Confirmed JB-to-JB menjadi solid link.
- Confirmed JB-to-CCTV menjadi solid link.
- Candidate/recommended menjadi suggested link.
- Candidate tidak masuk confirmed degree atau tracing.
- Cable/path menjadi metadata link dan tidak muncul sebagai node.
- Client tidak membuat link baru ketika backend tidak menyediakan evidence.
- Scope cabang dan area tidak bocor.

### 10.2 Layout

- Verified root berada pada level pertama.
- Backbone JB ditempatkan sebelum endpoint.
- Component tidak saling menimpa.
- Node tidak overlap pada hasil auto-layout.
- Layout deterministic untuk input yang sama.
- JB tanpa relasi tetap terlihat pada section Belum Terhubung.

### 10.3 Drag interaction

- Node dapat di-drag.
- Garis mengikuti node selama drag.
- Drag tidak mengubah graph atau relation status.
- Reset mengembalikan auto-layout.
- Reload membuang posisi manual.

### 10.4 Role dan readiness

- Admin dapat melihat draft dan suggested link aktif secara default.
- Pengguna operasional tidak dapat melihat draft topology.
- Pengguna operasional tidak melihat suggested layer atau review action.
- Dataset topology-ready dapat dilihat sesuai role.

### 10.5 Regression

- Peta Aset tidak berubah selain entry point Diagram Topologi.
- Selection dan trace context tetap dibawa melalui URL.
- Inspector, search, zoom, fit, minimap, SVG export, dan PNG export tetap berfungsi.
- Candidate tidak pernah dianggap confirmed sebelum mutation berhasil.

## 11. Acceptance criteria

1. Diagram secara visual terasa seperti workspace topology Cisco Packet Tracer.
2. Perangkat tampil sebagai ikon dengan nama di bawahnya.
3. Koneksi perangkat tampil sebagai garis lurus.
4. Backbone antar-JB yang confirmed terlihat jelas.
5. CCTV dan endpoint terlihat terhubung ke JB yang melayaninya.
6. Suggested connection tampil dashed dan tidak dapat tertukar dengan confirmed link.
7. Client tidak membuat koneksi fiktif.
8. Node dapat digeser tanpa mengubah relasi.
9. Reset mengembalikan auto-layout top-down.
10. Tidak ada visual port atau fungsi simulasi paket.
11. Diagram tidak mencampur cabang atau area.
12. Admin dapat menggunakan draft graph untuk menyelesaikan gap relasi.
13. Pengguna operasional hanya melihat graph topology-ready dan confirmed link.
14. Suggested link tidak pernah ikut tracing.
15. Diagram tetap responsif pada ukuran dataset aktif.

## 12. Urutan implementasi untuk Luna

1. Tambahkan projection `deviceNode` dan `topologyLink` tanpa mengubah source graph.
2. Pisahkan cable/path dari daftar node dan pindahkan metadata ke link.
3. Bentuk backbone confirmed JB-to-JB per area dan connected component.
4. Tambahkan candidate/recommended link sebagai suggested layer.
5. Implementasikan auto-layout top-down dengan prioritas backbone JB.
6. Ubah SVG renderer menjadi icon-first node dan straight link.
7. Tambahkan drag interaction, in-memory position, dan Reset.
8. Tambahkan selection, trace highlight, inspector, serta review suggested link.
9. Terapkan role dan topology-readiness gating.
10. Perbarui navigasi Diagram Topologi dan seluruh entry point dari Peta Aset.
11. Tambahkan unit, integration, role, layout, drag, dan regression test.
12. Uji beberapa area dengan graph besar, component terpisah, serta JB tanpa relasi.

## 13. Batasan implementasi

- Tidak membuat simulator jaringan.
- Tidak menyediakan konfigurasi router, switch, VLAN, IP, atau routing protocol.
- Tidak menampilkan atau mengedit port perangkat.
- Tidak menyimpan posisi drag ke backend pada fase ini.
- Tidak mengonfirmasi kandidat secara otomatis dari browser.
- Tidak menghubungkan JB hanya agar diagram terlihat rapi.
- Tidak mengganti Google Earth atau Peta Aset sebagai sumber posisi geografis.
