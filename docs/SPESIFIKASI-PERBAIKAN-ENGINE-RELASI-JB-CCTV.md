# Spesifikasi Perbaikan Engine Relasi JB, Kabel, Tiang, dan CCTV

Status: **spesifikasi dan handoff; belum diimplementasikan**  
Tanggal: 2026-08-13  
Target awal: pilot FT Pengapon — Semarang  
Pelaksana implementasi: **Luna**  
Acuan utama: [Spesifikasi Implementasi Fungsional Fase 1–5](./SPESIFIKASI-IMPLEMENTASI-FUNGSIONAL-FASE-1-5.md)

> Batas dokumen: dokumen ini mendefinisikan perubahan yang harus dikerjakan.
> Pembuatan dokumen tidak mengotorisasi atau menyatakan adanya perubahan pada
> engine, API, persistence, frontend, migration, maupun data topology aktif.

## 1. Ringkasan keputusan

Model topology saat ini masih terlalu mengandalkan kedekatan geometris. Karena
`tiang`, `CCTV`, dan `junction box` sama-sama diperlakukan sebagai device yang
mungkin kompatibel, endpoint kabel dapat menghasilkan kandidat menuju tiang
atau kamera meskipun peran fisiknya berbeda.

Perbaikan wajib memisahkan tiga graph:

1. **Graph pemasangan** — CCTV dan, bila sesuai kondisi lapangan, JB dipasang
   pada atau berada di tiang.
2. **Graph terminasi kabel** — setiap ujung kabel masuk ke interface perangkat
   yang sesuai. Tiang tidak pernah menjadi interface kabel.
3. **Graph layanan** — aliran data dan power diturunkan dari terminasi kabel,
   komponen internal JB, dan arah layanan yang sudah dikonfirmasi.

Kebijakan domain default untuk site pilot:

- setiap kabel operasional wajib memiliki minimal satu terminasi pada JB;
- kabel LAN/data dapat mengalir dari port LAN JB ke interface jaringan CCTV;
- feeder PLN berakhir pada terminal `power_in` JB;
- distribusi power keluar dari `power_out` JB menuju beban, termasuk CCTV;
- kabel backbone dapat menghubungkan JB ke JB atau JB ke perangkat jaringan;
- kabel LAN/fiber menuju rack server harus terminate pada interface komponen
  di dalam rack, bukan pada enclosure rack;
- tiang hanya menjadi host pemasangan dan tidak boleh menerima relasi
  `terminates_at`, `path-endpoint`, atau `path-inline-device`;
- pengecualian hanya boleh berasal dari metadata eksplisit atau policy
  versioned, bukan dari jarak spasial.

Dokumen ini tidak menganggap seluruh endpoint kabel harus menuju JB. Minimal
satu sisi kabel harus terikat ke JB; sisi lainnya ditentukan oleh kelas kabel.
Contohnya, kabel akses CCTV dapat memiliki terminasi `JB LAN -> CCTV`, sedangkan
feeder PLN memiliki terminasi `PLN -> JB power_in`.

## 2. Masalah pada engine saat ini

### 2.1 Compatibility matrix mencampur peran fisik

Implementasi `compatiblePathNode()` saat ini mengizinkan token `tiang|pole`
untuk beberapa network family. `inlineNodeAllowed()` juga mengizinkan tiang
menjadi anchor jalur. Konsekuensinya, kedekatan koordinat dapat membuat tiang
terlihat sebagai terminasi atau anchor kabel.

Ini salah secara domain karena tiang adalah struktur penopang, bukan konektor
data atau power.

### 2.2 Junction box diperlakukan sebagai node tunggal

JB sekarang hanya mempunyai kapasitas degree generik. Model tersebut belum
menjelaskan:

- port LAN;
- port atau splice fiber;
- terminal power input dari PLN;
- terminal power output menuju beban;
- komponen internal seperti switch, breaker, power supply, atau patching;
- kapasitas dan occupancy masing-masing interface.

Akibatnya, engine hanya mengetahui bahwa kabel “dekat JB”, tetapi tidak dapat
memastikan kabel masuk ke interface yang tepat.

### 2.3 Relasi pemasangan bercampur dengan relasi konektivitas

Relasi CCTV terhadap tiang merupakan relasi `mounted_on`. Relasi tersebut tidak
boleh membuat CCTV dan tiang terlihat terhubung dalam tracing jaringan atau
power. Saat seluruh relasi device/path dimaterialisasi ke graph yang sama,
mounting dapat keliru dianggap sebagai connectivity.

### 2.4 Kapasitas dihitung pada asset, bukan interface

Degree limit generik tidak cukup untuk JB. Sebuah JB dapat memiliki, misalnya,
8 port LAN, 1 power input, dan 4 power output. Kapasitas harus diperiksa per
jenis interface dan per port, bukan hanya jumlah edge pada node JB.

### 2.5 Candidate ambigu terbentuk setelah hard gate yang terlalu longgar

Contoh pilot:

- `FO-CR_JB-004 -> JB-004` dan `FO-CR_JB-004 -> T-004` dianggap alternatif;
- secara domain, `T-004` harus gugur sebelum scoring karena tiang bukan target
  terminasi kabel;
- jarak yang sedikit lebih dekat tidak boleh mengalahkan ketidakcocokan peran.

Ambiguitas hanya sah jika dua target sama-sama kompatibel secara domain,
misalnya dua JB yang valid berada dekat endpoint yang sama.

## 3. Tujuan dan non-tujuan

### 3.1 Tujuan

- Menghasilkan topology yang sesuai alur fisik JB, kabel, tiang, dan CCTV.
- Mencegah kandidat cable-to-pole sejak hard gate.
- Merepresentasikan JB sebagai enclosure dengan interface dan komponen.
- Menjaga Asset ID serta component/port ID stabil tanpa input manual massal.
- Memisahkan graph pemasangan dari graph konektivitas dan graph layanan.
- Menyediakan migrasi aman untuk candidate dan confirmed relation lama.
- Mempertahankan provenance, audit, optimistic concurrency, idempotency, dan
  confirmed-only tracing.

### 3.2 Non-tujuan

- Mengubah koordinat atau melakukan snap pada source KML.
- Menebak wiring internal JB tanpa profile atau evidence.
- Mengonfirmasi relasi hanya karena dua object berdekatan.
- Meminta admin membuat ID untuk setiap port secara manual.
- Menganggap relasi mounting dapat digunakan untuk tracing data/power.

## 4. Model domain target

### 4.1 Asset utama

| Asset type | Peran | Boleh menjadi endpoint kabel | Boleh menjadi host |
|---|---|---:|---:|
| `junction_box` | Enclosure terminasi/distribusi | Ya, melalui interface | Ya, opsional |
| `cctv_camera` | Beban data dan power | Ya, melalui interface kamera | Tidak |
| `pole` | Struktur pemasangan | **Tidak** | Ya |
| `pln_source` | Sumber power eksternal | Ya, melalui power output | Tidak |
| `switch` | Perangkat distribusi data | Ya, melalui port | Tidak |
| `otb` | Terminasi fiber | Ya, melalui port/splice | Tidak |
| `nvr/router/core` | Perangkat jaringan | Ya, melalui port | Tidak |
| `server_rack` | Enclosure perangkat pusat | Tidak secara langsung | Ya, untuk komponen rack |
| `patch_panel` | Terminasi pasif di rack | Ya, melalui port | Tidak |
| `cable_path` | Jalur fisik kabel | Memiliki dua endpoint | Tidak |

### 4.2 Interface minimum

Interface merupakan termination point, bukan asset bisnis mandiri.

| Interface type | Pemilik umum | Media/domain | Direction default |
|---|---|---|---|
| `lan_port` | JB, switch, CCTV | copper/data | bidirectional |
| `fiber_port` | JB, OTB, switch | fiber/data | bidirectional |
| `power_in` | JB, CCTV | copper/power | input |
| `power_out` | JB, PLN source, power supply | copper/power | output |
| `uplink_port` | JB, switch/router | data | bidirectional |
| `splice_slot` | JB, OTB | fiber | undirected |
| `patch_port` | Patch panel dalam rack | copper/data atau fiber/data | undirected |
| `server_nic` | Server/NVR | copper/data atau fiber/data | bidirectional |

### 4.3 Component JB

Model JB harus mendukung dua tingkat kedalaman:

1. **Opaque JB profile** untuk data awal yang belum mempunyai daftar komponen.
   Sistem membuat interface virtual yang stabil dari template JB.
2. **Detailed component inventory** untuk data enterprise, misalnya switch,
   breaker, power supply, terminal block, OTB, dan patch panel.

Contoh struktur:

```text
JB-004
├── DATA
│   ├── UPLINK-01
│   ├── LAN-01
│   ├── LAN-02
│   └── LAN-03
└── POWER
    ├── POWER-IN-01
    ├── POWER-OUT-01
    ├── POWER-OUT-02
    └── POWER-OUT-03
```

ID internal dibuat otomatis dan disimpan di registry:

```text
component_id = persisted deterministic assignment
interface_id = <jb_asset_id>/interface/<type>/<ordinal>
```

Contoh:

```text
JB-004/interface/lan/01
JB-004/interface/power-in/01
JB-004/interface/power-out/02
```

ID tersebut tidak dihitung ulang setiap request. Assignment pertama harus
dipersistenkan agar perubahan nama, urutan source, atau profile tidak mengganti
identitas interface yang sudah memiliki relasi.

### 4.4 JB lapangan dan rack server

Istilah sumber seperti **JB Rack Server** harus diklasifikasikan dengan hati-hati.
Secara fisik terdapat dua kemungkinan yang tidak boleh disatukan otomatis:

1. **JB lapangan** adalah enclosure terminasi/distribusi dekat CCTV. Isinya dapat
   berupa terminal, splice, switch kecil, breaker, dan power supply.
2. **Rack server** adalah enclosure pusat yang menampung patch panel, switch,
   router, NVR, dan server.

Kabel LAN atau fiber memang berhubungan dengan rack server, tetapi termination
fisiknya terjadi pada interface komponen di dalam rack:

```text
Kabel LAN -> patch panel port -> patch cord -> switch port
Kabel LAN -> switch port                         (jika tanpa patch panel)
Kabel LAN -> server/NVR NIC                      (direct connection eksplisit)
Kabel FO  -> OTB/fiber patch panel -> switch uplink
```

Relasi enclosure dipisahkan dari konektivitas:

```text
PATCH-PANEL-01 --installed_in--> RACK-SERVER-01
SWITCH-CORE-01 --installed_in--> RACK-SERVER-01
NVR-01         --installed_in--> RACK-SERVER-01
```

`installed_in` tidak traversable. Tracing data melewati port dan internal link
yang confirmed, bukan melewati node rack.

Jika source saat ini hanya mempunyai satu Point bernama `JB Rack Server` tanpa
inventaris komponen, engine boleh memakai **opaque rack profile** dan membuat
interface proxy otomatis. Contoh:

```text
JB-RACK-SERVER-01/interface/lan/01
JB-RACK-SERVER-01/interface/fiber/01
```

Proxy tersebut mempertahankan termination cable, tetapi tidak boleh mengarang
bahwa semua port saling terhubung atau bahwa kabel sudah mencapai server/NVR.
Setelah inventaris rack tersedia, proxy dimigrasikan ke patch panel/switch/NIC
yang sebenarnya tanpa mengganti audit history cable termination.

### 4.5 Pemisahan dimensi klasifikasi

`networkFamily` saja tidak cukup untuk membedakan fungsi kabel. Contract baru
menambahkan dimensi berikut:

```text
service_domain: data | power | mounting | unknown
media_type: copper_lan | fiber | power_copper | none | unknown
cable_role: access | uplink | backbone | feeder | distribution | unknown
endpoint_role: origin | destination | undirected
```

Field lama tetap dibaca selama migrasi, tetapi engine v2 mengambil keputusan
dari kombinasi dimensi di atas.

## 5. Tiga graph yang wajib dipisahkan

### 5.1 Installation graph

Menjawab “asset ini dipasang di mana?”.

```text
CCTV-026 --mounted_on--> T-026
JB-004   --installed_on--> T-004    (hanya jika ada evidence)
```

Relation kind: `installation_attachment`.

Edge ini boleh tampil di detail asset, tetapi tidak ikut traversal data/power,
component merge, root discovery, atau failure simulation jaringan.

### 5.2 Physical termination graph

Menjawab “ujung kabel ini benar-benar masuk ke interface mana?”.

```text
FO-CR_JB-004:end --terminates_at--> JB-004/interface/fiber/01
PLN-004:end      --terminates_at--> JB-004/interface/power-in/01
UTP-CCTV-026:end --terminates_at--> CCTV-026/interface/lan/01
```

Relation kind: `path_termination`.

Setiap endpoint kabel maksimal memiliki satu termination confirmed. Setiap
interface maksimal menerima jumlah termination sesuai kapasitasnya.

### 5.3 Service graph

Menjawab “data atau power mengalir melalui jalur mana?”. Graph ini merupakan
projection dari termination confirmed dan internal connectivity JB confirmed.

Contoh aliran data:

```text
CORE/SWITCH
  -> kabel uplink
  -> JB-004/UPLINK-01
  -> internal switch/patch policy
  -> JB-004/LAN-02
  -> kabel akses
  -> CCTV-026/LAN-01
```

Contoh aliran hingga rack server:

```text
CCTV-026/LAN-01
  -> kabel akses
  -> JB-004/LAN-02
  -> JB-004/UPLINK-01
  -> kabel uplink/backbone
  -> RACK-SERVER-01/PATCH-01
  -> patch cord/internal connection
  -> SWITCH-CORE-01/PORT-24
  -> NVR-01/NIC-01
```

Contoh aliran power:

```text
PLN
  -> feeder
  -> JB-004/POWER-IN-01
  -> breaker/power supply
  -> JB-004/POWER-OUT-02
  -> kabel distribusi
  -> CCTV-026/POWER-IN-01
```

Internal traversal JB hanya boleh terjadi jika salah satu tersedia:

- wiring/component metadata eksplisit;
- JB profile versioned yang disetujui;
- keputusan manual administrator dengan evidence.

Tidak ada “semua port dalam satu JB otomatis saling terhubung”.

## 6. Relation contract v2

### 6.1 Relation utama

```json
{
  "relationId": "relation:...",
  "datasetVersionId": "dataset-semarang-v20",
  "relationKind": "path_termination",
  "relationType": "terminates_at",
  "sourceAssetId": "FO-CR_JB-004",
  "sourceEndpointId": "endpoint:geometry:fo-cr-jb-004:end",
  "targetAssetId": "JB-004",
  "targetInterfaceId": "JB-004/interface/fiber/01",
  "serviceDomain": "data",
  "mediaType": "fiber",
  "direction": "undirected",
  "verificationStatus": "confirmed",
  "provenance": "manual_review",
  "topologyRuleSetVersion": "semantic-relation-engine/2.0.0",
  "evidence": []
}
```

### 6.2 Relation mounting

```json
{
  "relationKind": "installation_attachment",
  "relationType": "mounted_on",
  "sourceAssetId": "CCTV-026",
  "targetAssetId": "T-026",
  "serviceDomain": "mounting",
  "direction": "source_to_target",
  "traversable": false
}
```

### 6.3 Internal JB relation

```json
{
  "relationKind": "internal_connection",
  "relationType": "internally_connected_to",
  "sourceInterfaceId": "JB-004/interface/uplink/01",
  "targetInterfaceId": "JB-004/interface/lan/02",
  "serviceDomain": "data",
  "direction": "bidirectional",
  "provenance": "approved_jb_profile",
  "profileVersion": "jb-profile/1.0.0"
}
```

## 7. Compatibility matrix v2

Hard gate dijalankan sebelum distance scoring.

| Cable class | Endpoint A yang diizinkan | Endpoint B yang diizinkan | Syarat JB |
|---|---|---|---|
| LAN/CCTV access | JB `lan_port` | CCTV/switch `lan_port` | Minimal satu endpoint JB |
| Fiber access/uplink | JB/OTB `fiber_port` | JB/OTB/switch `fiber_port` | Minimal satu endpoint JB pada policy pilot |
| Data backbone | JB/switch/router `uplink_port` | JB/switch/router `uplink_port` | Sesuai site policy |
| LAN ke rack | JB/switch `uplink_port` | Rack `patch_port`, switch port, atau NIC | Rack enclosure bukan endpoint |
| Fiber ke rack | JB/OTB `fiber_port` | Rack OTB/patch panel/switch `fiber_port` | Rack enclosure bukan endpoint |
| PLN feeder | PLN/panel `power_out` | JB `power_in` | Endpoint tujuan wajib JB |
| Power distribution | JB `power_out` | CCTV/perangkat `power_in` | Endpoint sumber wajib JB |
| Mounting | CCTV/JB | Tiang | Bukan cable relation |

Larangan absolut default:

- cable endpoint -> pole;
- cable inline anchor -> pole;
- power cable -> LAN/fiber port;
- data cable -> power port;
- mounting edge ikut service tracing;
- LAN/fiber terminate langsung pada enclosure `server_rack` tanpa interface;
- proximity mengubah pasangan yang gagal hard gate menjadi valid;
- dua endpoint cable memakai interface single-occupancy yang sama;
- internal JB bridge tanpa profile/evidence.

Pengecualian harus didefinisikan pada policy versioned:

```json
{
  "siteId": "FT-PENGAPON",
  "requireJbTermination": true,
  "allowDirectCameraTermination": true,
  "allowCableToPole": false,
  "allowOpaqueJbInternalBridge": false
}
```

## 8. Candidate generation v2

### 8.1 Urutan pipeline

```text
classification
-> asset/interface registry resolution
-> endpoint role inference
-> semantic hard gates
-> spatial candidate discovery
-> component/interface compatibility
-> scoring
-> cardinality/capacity validation
-> proposal status
-> review queue
```

Semantic hard gate harus dilakukan sebelum kandidat masuk scoring. Dengan
demikian, tiang yang berjarak 0,2 meter tidak akan mengalahkan JB yang berjarak
2 meter.

### 8.2 Candidate type baru

| Candidate type | Makna |
|---|---|
| `cable_termination` | Endpoint kabel ke interface perangkat |
| `mounting_attachment` | CCTV/JB dipasang pada tiang |
| `jb_internal_connection` | Hubungan antar-interface/komponen dalam JB |
| `path_continuation` | Kelanjutan dua cable segment yang sah |
| `explicit_metadata` | Relasi eksplisit dari source/registry |
| `unresolved_termination` | Endpoint belum memiliki target kompatibel |

`endpoint_device`, `inline_device`, dan `line_label_attachment` dipertahankan
sementara sebagai compatibility projection API, lalu dihentikan setelah semua
consumer pindah ke contract v2.

### 8.3 Endpoint role inference

Urutan evidence:

1. metadata endpoint eksplisit;
2. cable name/label yang lolos parser terstruktur;
3. hubungan dengan JB/interface yang sudah confirmed pada versi sebelumnya;
4. source folder dan cable class;
5. spatial evidence.

Jika arah tidak dapat ditentukan, physical termination tetap boleh
`undirected`, tetapi service flow tidak boleh mengarang arah.

### 8.4 Scoring

Score hanya membandingkan kandidat yang sudah lolos hard gate.

Komponen yang disarankan:

```text
interface compatibility       0.30
explicit/registry evidence    0.25
distance                      0.15
cable label correspondence    0.15
site/folder context           0.05
endpoint role consistency     0.05
capacity availability         0.05
```

Bobot wajib versioned dan divalidasi melalui held-out artifact. Distance tidak
boleh menjadi faktor terbesar.

### 8.5 Cardinality

Decision key baru:

```text
cable termination : sourceEndpointId
mounting           : childAssetId + mountingRole
internal JB link   : sourceInterfaceId + serviceDomain
path continuation  : normalized endpoint pair
```

Invariant:

- satu endpoint kabel maksimal satu termination confirmed;
- satu CCTV dapat memiliki satu mounting host aktif per mounting role;
- satu tiang dapat menjadi host banyak CCTV sesuai mounting capacity;
- satu JB dapat menerima banyak kabel melalui interface yang berbeda;
- single-occupancy interface maksimal satu termination aktif;
- multi-occupancy terminal mengikuti capacity profile.

### 8.6 Proposal status

- `recommended`: satu target kompatibel dan seluruh constraint lolos;
- `ambiguous`: lebih dari satu target kompatibel dengan margin tidak cukup;
- `interface_unavailable`: target asset valid tetapi port penuh/tidak tersedia;
- `missing_jb_termination`: cable tidak memiliki satu pun endpoint JB;
- `incompatible_interface`: media/domain tidak cocok;
- `forbidden_target_role`: target seperti tiang terdeteksi dekat endpoint;
- `unresolved`: tidak ada target compatible;
- `obsolete_rule_set`: candidate berasal dari engine sebelum v2.

`forbidden_target_role` disimpan sebagai diagnostic evidence, bukan sebagai
candidate yang dapat dikonfirmasi.

## 9. Perubahan pada modul implementasi

### 9.1 Classification dan publication contract

Target:

- `backend/src/domain/parser-contract.js`
- `backend/src/domain/publication-contract.js`

Perubahan:

- bedakan canonical `pole`, `junction_box`, `cctv_camera`, `server_rack`,
  `patch_panel`, `switch`, `nvr`, `server`, dan perangkat jaringan lain;
- tambahkan `serviceDomain`, `mediaType`, `cableRole`, serta evidence-nya;
- jangan memakai `supporting_infrastructure` sebagai keputusan akhir jika
  object dapat diklasifikasikan lebih spesifik;
- bump classification rule set setelah fixture migrasi lulus.

### 9.2 Semantic relation engine

Target: `backend/src/topology/semantic-relation-engine.js`.

Perubahan wajib:

- keluarkan `tiang|pole` dari `compatiblePathNode()`;
- keluarkan `tiang|pole` dari `inlineNodeAllowed()`;
- ganti regex compatibility dengan matrix berdasarkan role, domain, media,
  cable role, dan interface;
- ganti `nodeCapacity()` dengan interface capacity evaluation;
- ganti `endpointRoleScore()` agar semantic role menjadi hard gate;
- hasilkan mounting candidate melalui generator terpisah;
- materialisasi graph berdasarkan `relationKind` dan traversal domain;
- bump `TOPOLOGY_RULE_SET_VERSION` ke `semantic-relation-engine/2.0.0` hanya
  setelah migrasi dan test siap.

### 9.3 Cardinality dan review service

Target:

- `backend/src/topology/topology-cardinality.js`
- `backend/src/topology/topology-service.js`

Perubahan:

- decision key memakai contract pada bagian 8.5;
- bulk preview menolak kombinasi interface conflict;
- select-target menutup seluruh kandidat pada termination slot yang sama;
- confirmed relation menyimpan `targetInterfaceId`;
- direct confirmation gagal jika candidate memerlukan pilihan interface;
- regeneration membandingkan rule-set version dan menandai candidate lama
  sebagai superseded.

### 9.4 Accuracy dan validation

Target: `backend/src/topology/topology-accuracy.js`.

Tambahkan metric per kelas:

- cable-to-JB termination precision/recall;
- cable-to-pole false-positive rate, target **0%**;
- interface type accuracy;
- mounting relation precision/recall;
- service path accuracy untuk data dan power secara terpisah;
- false component merge;
- unresolved rate dan review coverage.

### 9.5 Frontend review

Target: `frontend/src/pages/admin/topology-review-page.js` dan domain review.

UI harus:

- menampilkan jenis keputusan: mounting, data termination, power termination,
  atau internal JB;
- menampilkan `Asset -> JB -> component/interface`, bukan hanya dua nama asset;
- menampilkan hierarchy `Rack -> patch panel/switch/NVR -> interface` untuk
  terminasi di ruang server;
- mengelompokkan alternatif berdasarkan termination decision key;
- tidak menampilkan tiang sebagai target cable;
- menampilkan occupancy/capacity port;
- memberikan alasan khusus saat JB atau interface belum tersedia;
- memisahkan layer visual installation dari data/power connectivity.

## 10. Identity dan registry komponen

Admin tidak boleh mengisi port ID satu per satu.

Flow default:

1. Resolver menemukan JB dengan Asset ID stabil.
2. Sistem membaca `jbProfileId` dari metadata/registry.
3. Jika profile valid, sistem membuat component/interface assignment secara
   deterministik.
4. Assignment dipersistenkan dalam registry dan digunakan lintas dataset
   version.
5. Admin hanya menangani duplicate JB, profile ambigu, kapasitas tidak cocok,
   atau nomor port resmi perusahaan.

Minimal registry record:

```text
interface_id
owner_asset_id
interface_type
service_domain
media_type
direction
capacity
occupancy
profile_id
assignment_source
source_feature_id?
status
created_at
retired_at?
```

Input manual hanya diperlukan jika perusahaan mewajibkan nomor terminal resmi
atau source evidence saling bertentangan.

## 11. Migrasi candidate dan relation lama

Perubahan rule ini bersifat semantic breaking change. Relasi lama tidak boleh
diam-diam diterjemahkan menjadi model baru.

### 11.1 Inventarisasi

Sebelum regenerasi, buat laporan:

- confirmed/candidate cable-to-pole;
- cable-to-CCTV tanpa terminasi JB pada cable yang sama;
- cable-to-JB tanpa klasifikasi interface;
- JB dengan degree di atas kapasitas profile;
- mounting yang saat ini direpresentasikan sebagai path attachment;
- trace yang akan berubah setelah rule-set v2.

### 11.2 Status migrasi

- candidate v1 yang belum direview -> `obsolete_rule_set`;
- confirmed cable-to-pole -> `migration_review_required` dan dikeluarkan dari
  graph v2 sampai dipetakan ulang;
- confirmed cable-to-JB yang kompatibel -> dipertahankan hanya setelah
  interface assignment tervalidasi;
- mounting relation -> dipindahkan ke installation graph;
- audit history lama tetap immutable.

### 11.3 Regenerasi

1. Bekukan publication topology selama migrasi site.
2. Generate interface registry.
3. Jalankan engine v2 dalam shadow mode.
4. Bandingkan component, relation, dan trace v1-v2.
5. Review seluruh breaking change.
6. Publish graph v2 secara atomic.
7. Simpan pointer rollback ke graph v1.

Tidak boleh ada periode ketika sebagian relation memakai cardinality v1 dan
sebagian memakai cardinality v2 dalam satu operational graph.

## 12. API contract tambahan

### 12.1 Candidate projection

Candidate menambahkan:

```json
{
  "candidateType": "cable_termination",
  "sourceEndpointId": "endpoint:...",
  "targetAssetId": "JB-004",
  "targetInterfaceId": "JB-004/interface/lan/02",
  "serviceDomain": "data",
  "mediaType": "copper_lan",
  "cableRole": "access",
  "reviewCardinality": {
    "scope": "cable_endpoint",
    "key": "cable-endpoint:[...]"
  },
  "constraintEvidence": {
    "requiresJbTermination": true,
    "jbTerminationSatisfied": true,
    "interfaceCapacityAvailable": true
  }
}
```

### 12.2 JB detail projection

```text
GET /api/dataset-versions/:id/topology/junction-boxes/:assetId
```

Response memuat profile, component, interface, occupancy, relation confirmed,
candidate pending, dan provenance. Endpoint tetap versioned, paginated bila
collection besar, serta dilindungi authorization yang sama dengan topology.

### 12.3 Preview/regeneration

Preview wajib mengembalikan:

- relation yang ditambah, dipertahankan, dihapus, atau membutuhkan review;
- cable-to-pole removal count;
- missing-JB termination count;
- interface capacity conflict count;
- trace delta data dan power;
- affected component dan affected asset;
- graph, candidate, interface-registry, dan rule-set revision.

## 13. Validation invariant

Blocking validation:

- `cable_terminated_at_pole`;
- `required_jb_termination_missing`;
- `interface_media_mismatch`;
- `interface_service_domain_mismatch`;
- `interface_capacity_exceeded`;
- `power_direction_invalid`;
- `unapproved_internal_jb_bridge`;
- `mixed_topology_rule_set`;
- dangling asset/component/interface reference;
- mounting relation masuk service graph;
- data edge masuk power trace atau sebaliknya.

Warning:

- JB memakai opaque profile;
- cable direction belum diketahui;
- interface virtual belum memiliki nomor resmi;
- JB profile berasal dari default site, bukan metadata asset;
- candidate valid tetapi evidence hanya spatial.

Operational topology berstatus `ready` hanya jika tidak ada blocking validation
dan seluruh topology-required cable memiliki terminasi sesuai policy.

## 14. Review UX target

Untuk setiap kabel, UI menampilkan dua sisi terminasi:

```text
Kabel: UTP-CCTV-026

Sisi A  JB-004 / LAN-02       Confirmed
Sisi B  CCTV-026 / LAN-01     Perlu ditinjau

Mounting terkait
CCTV-026 mounted_on T-026     Confirmed
```

Jika dua JB valid berada berdekatan, tombol **Pilih target** menampilkan:

- nama dan Asset ID JB;
- interface yang compatible;
- occupancy/capacity;
- jarak;
- source/folder/label evidence;
- dampak trace jika dipilih.

Tiang yang dekat boleh ditampilkan sebagai konteks peta, tetapi tidak menjadi
opsi target cable.

## 15. Audit dan observability

Audit event minimum:

- `topology.interface_registry_generated`;
- `topology.candidate_superseded_by_rule_set`;
- `topology.cable_termination_selected`;
- `topology.mounting_selected`;
- `topology.jb_profile_assigned`;
- `topology.internal_connection_confirmed`;
- `topology.v2_published`;
- `topology.v2_rolled_back`.

Metric minimum:

```text
topology_candidate_count{candidate_type,proposal_status}
topology_forbidden_target_count{target_role}
topology_missing_jb_termination_count{site,cable_role}
topology_interface_occupancy{site,interface_type}
topology_interface_capacity_conflict_count{site}
topology_service_trace_failure_count{service_domain,reason}
topology_rule_set_migration_relation_delta{change_type}
```

Label metric tidak boleh memuat Asset ID agar cardinality tetap bounded.

## 16. Test dan fixture wajib

### 16.1 Unit test

- pole ditolak sebagai endpoint seluruh cable class;
- pole tetap valid sebagai mounting host CCTV;
- JB LAN port menerima LAN dan menolak power;
- JB power input menerima feeder PLN dan menolak LAN;
- satu endpoint cable tidak dapat memiliki dua target confirmed;
- satu JB dapat menerima banyak kabel pada interface berbeda;
- capacity dievaluasi per interface;
- mounting edge tidak masuk service traversal;
- internal JB traversal membutuhkan profile/evidence;
- rule-set v1 candidate tidak dapat dikonfirmasi pada graph v2.

### 16.2 Regression fixture Pengapon

- `FO-CR_JB-004 -> JB-004` tetap menjadi kandidat valid;
- `FO-CR_JB-004 -> T-004` tidak dibuat sebagai kandidat reviewable;
- `T-021`, `T-014`, dan `T-TOWER` dapat menampung beberapa CCTV sebagai
  mounting host tanpa menjadi cable anchor;
- kandidat kamera di sekitar `STP-RS_C-026` hanya valid jika endpoint tersebut
  memang sisi device dan sisi cable lainnya sudah/akan terminate pada JB;
- jika tidak ada JB termination untuk cable tersebut, hasilnya
  `missing_jb_termination`, bukan confirmation otomatis;
- empat baris ambigu lama tidak muncul kembali setelah regeneration v2 kecuali
  benar-benar ada dua JB/interface compatible.
- kabel menuju `JB Rack Server` terminate ke port proxy atau komponen rack,
  bukan ke enclosure rack dan bukan otomatis ke seluruh server/NVR.

### 16.3 Property dan integration test

- output deterministik terhadap permutation input;
- source geometry tidak berubah;
- concurrent review tetap menghasilkan satu pemenang per endpoint/interface;
- regeneration dan review tidak menyebabkan lost update;
- preview dan apply menghasilkan graph delta yang sama;
- rollback mengembalikan graph beserta interface registry revision;
- tracing data tidak melewati power component;
- tracing power tidak melewati LAN/fiber component;
- 10.000/50.000-object benchmark tetap berada dalam budget yang disetujui.

### 16.4 Held-out evaluation

Dataset evaluasi harus memiliki label untuk:

- target JB dan interface;
- target device pada sisi lainnya;
- mounting CCTV-tiang;
- cable class/domain/media;
- known data path;
- known power path;
- negative cable-to-pole examples.

Target minimum sebelum spatial auto-confirm dipertimbangkan:

- cable-to-pole false positive: **0%**;
- precision termination target: **>= 99%**;
- known-path accuracy data: **>= 95%**;
- known-path accuracy power: **>= 95%**;
- false component merge: **0**;
- seluruh hasil tetap terikat ke rule-set version dan engine build SHA.

Spatial auto-confirm tetap OFF sampai artifact tersebut tersedia dan disetujui.

## 17. Checkpoint implementasi

Checkpoint ini terpisah dari Fase 1–5 agar semantic breaking change dapat
diaudit dan di-rollback secara mandiri.

### JB-00 — Domain sign-off

- [ ] Validasi bahwa setiap cable pilot wajib memiliki minimal satu terminasi JB.
- [ ] Validasi kelas cable dan direction tiap folder/naming convention.
- [ ] Validasi apakah JB selalu dipasang pada tiang atau dapat berdiri terpisah.
- [ ] Setujui minimum JB profile dan capacity.
- [ ] Setujui pengecualian direct termination.

Output: domain decision record dan fixture berlabel.

### JB-01 — Contract dan classification

- [ ] Tambahkan role/domain/media/cable role.
- [ ] Tambahkan component/interface registry contract.
- [ ] Tambahkan migration/schema dan API projection.
- [ ] Tambahkan parser/classifier fixtures.

Exit gate: seluruh object pilot terklasifikasi atau berstatus review-required;
tidak ada fallback diam-diam.

### JB-02 — Candidate engine v2

- [ ] Implement semantic hard gate.
- [ ] Pisahkan mounting generator dari cable termination generator.
- [ ] Implement interface-aware scoring/cardinality/capacity.
- [ ] Implement diagnostic `missing_jb_termination` dan forbidden target.
- [ ] Bump rule-set version.

Exit gate: cable-to-pole candidate reviewable = 0 dan seluruh regression test
lulus.

### JB-03 — Graph, tracing, dan review transaction

- [ ] Pisahkan installation, physical termination, dan service graph.
- [ ] Implement internal JB connectivity policy.
- [ ] Update select-target, bulk preview, revoke, dan regeneration.
- [ ] Update data/power tracing serta impact simulation.

Exit gate: mounting tidak pernah memengaruhi service traversal dan preview/apply
parity lulus.

### JB-04 — UI dan migration tooling

- [ ] Tampilkan JB component/interface hierarchy.
- [ ] Tampilkan occupancy dan incompatibility reason.
- [ ] Buat v1-v2 topology diff report.
- [ ] Buat shadow regeneration serta atomic publication/rollback.

Exit gate: admin dapat menyelesaikan review tanpa membuat ID port manual.

### JB-05 — Pilot dan production gate

- [ ] Jalankan fixture dan source pilot FT Pengapon.
- [ ] Review seluruh breaking relation delta.
- [ ] Verifikasi known path data dan power bersama teknisi lapangan.
- [ ] Jalankan concurrency, recovery, performance, dan rollback drill.
- [ ] Dapatkan domain, administrator, dan operator sign-off.

Exit gate: seluruh acceptance criteria bagian 18 terpenuhi.

## 18. Acceptance criteria final

Implementasi dianggap selesai hanya jika:

1. Tidak ada cable relation confirmed menuju tiang.
2. Semua cable operasional memenuhi JB termination policy atau memiliki
   exception eksplisit yang diaudit.
3. CCTV-to-pole hanya muncul sebagai `mounted_on` dan non-traversable.
4. LAN, fiber, dan power terminate pada interface yang compatible.
5. Capacity dihitung per interface, bukan degree asset generik.
6. JB internal traversal memiliki profile/evidence versioned.
7. Candidate lama dari rule-set v1 tidak dapat diterapkan ke graph v2.
8. Regeneration tidak mengubah source geometry dan bersifat deterministik.
9. Preview/apply, concurrency, idempotency, audit, dan rollback lulus.
10. Known-path data dan power sesuai verifikasi lapangan.
11. Admin tidak perlu membuat Asset ID atau port ID massal secara manual.
12. Held-out artifact dan production SLO memenuhi target yang disetujui.

## 19. Keputusan domain yang masih harus dikonfirmasi

Pertanyaan berikut tidak boleh dijawab engine melalui asumsi:

1. Apakah seluruh JB di site dipasang pada tiang, atau sebagian berdiri di
   struktur lain?
2. Apakah setiap cable path pada KML merepresentasikan satu media, atau satu
   garis dapat mewakili bundel data dan power?
3. Apakah setiap kabel akses CCTV selalu mempunyai satu sisi JB dan satu sisi
   kamera?
4. Apakah feeder PLN digambar sebagai asset cable yang sama dengan distribusi
   power dari JB?
5. Berapa port LAN, fiber, power input, dan power output per tipe JB?
6. Apakah nomor port resmi tersedia di source/companion registry?
7. Apakah ada kamera yang mendukung direct fiber atau direct PLN tanpa JB?
8. Apakah nama seperti `STP-RS_C-026` mengidentifikasi cable destination,
   circuit, atau hanya label operasional?
9. Apakah internal switch/breaker harus dimodelkan satu per satu atau cukup
   melalui approved JB profile?
10. Apakah `JB Rack Server` pada source berarti JB, enclosure rack, patch
    panel, atau nama lokasi gabungan?
11. Apakah tersedia inventaris patch panel, switch, NVR/server, nomor port,
    serta patching di dalam rack?
12. Apakah kabel dari JB lapangan menuju rack memakai copper LAN, fiber, atau
    keduanya pada jalur yang berbeda?

Jawaban harus disimpan sebagai site policy/profile versioned dan menjadi input
engine, bukan hard-coded berdasarkan contoh satu site.

## 20. Definition of done

Perubahan tidak cukup dinyatakan selesai saat UI tidak lagi menampilkan
kandidat yang mengganggu. Selesai berarti model domain, persistence, candidate
generation, review, graph, tracing, validation, audit, migration, test, dan
operational sign-off memakai aturan yang sama dari ujung ke ujung.

## 21. Handoff eksekusi untuk Luna

Luna harus menjalankan pekerjaan melalui checkpoint `JB-00` sampai `JB-05` dan
membuat commit/checkpoint terpisah untuk setiap tahap. Urutan tidak boleh
dibalik karena engine v2 bergantung pada keputusan domain dan contract yang
sudah disetujui.

Sebelum mengubah kode, Luna wajib:

1. membaca dokumen ini seluruhnya;
2. memastikan jawaban bagian 19 sudah diberikan oleh pemilik domain;
3. mengambil baseline candidate, confirmed relation, graph, trace, dan revision
   FT Pengapon;
4. memastikan branch kerja tidak langsung mengubah `main`;
5. mencatat file dan data migration yang akan terdampak;
6. memastikan rollback graph v1 tersedia.

Setiap checkpoint harus menyerahkan:

- ringkasan keputusan dan asumsi;
- daftar file/schema/API yang berubah;
- migration up/down bila ada persistence change;
- fixture dan test baru;
- hasil lint, unit, integration, concurrency, dan build yang relevan;
- topology diff terhadap baseline Pengapon;
- risiko yang belum tertutup;
- commit hash dan status push;
- keputusan `pass`, `fail`, atau `blocked` terhadap exit gate checkpoint.

Luna tidak boleh:

- mengonfirmasi atau menghapus relasi production sebagai workaround;
- mengubah kandidat cable-to-pole menjadi mounting hanya berdasarkan jarak;
- menganggap `JB Rack Server` sebagai JB lapangan tanpa domain evidence;
- membuat seluruh port internal JB/rack saling terhubung otomatis;
- meminta admin mengisi ID port secara massal;
- menaikkan rule-set version tanpa migration dan regression coverage;
- menyatakan enterprise-ready hanya berdasarkan synthetic fixture.

Handoff dianggap diterima jika Luna dapat mengulang kembali tiga invariant inti:

```text
Tiang = host pemasangan, bukan endpoint kabel.
JB/rack = enclosure; kabel terminate pada interface yang kompatibel.
Tracing layanan hanya memakai termination dan internal connection confirmed.
```
