# Kontrak Data KML dan Topologi SINERGI

Status: usulan v1 untuk migrasi data sumber aktual

Dokumen arsitektur pelaksana:
[Arsitektur Terpadu Parser dan Relasi Aset](./ARSITEKTUR-PIPELINE-PARSER-DAN-RELASI-ASSET.md).

## 1. Prinsip

KML adalah format pertukaran spasial, bukan otomatis menjadi canonical
inventory atau network graph.

Tiga identitas harus dibedakan:

- `source_feature_id`: identitas objek pada file sumber;
- `asset_id`: identitas bisnis yang stabil lintas versi;
- `geometry_id`: identitas geometri milik asset pada satu dataset version.

Relasi topologi bukan LineString. Relasi adalah hubungan antar-node yang
memiliki provenance dan confidence.

## 2. Metadata minimum yang direkomendasikan

Untuk Placemark yang mewakili asset:

| Field | Wajib | Keterangan |
|---|---|---|
| `asset_id` | ya | Stabil dan unik lintas versi |
| `asset_name` | ya | Nama manusia |
| `asset_type` | ya | Tipe dari controlled vocabulary |
| `category` | ya | Kategori utama |
| `site_id` | ya | Scope lokasi |
| `source_status` | ya | active, planned, retired |
| `connected_to` | kondisional | Daftar Asset ID target |
| `relation_type` | kondisional | Tipe hubungan jika eksplisit |

Opsional:

- `ip_address`
- `hostname`
- `owner_unit`
- `installation_status`
- `notes`
- `external_monitoring_id`

Dokumentasi KML resmi menyediakan `ExtendedData` untuk custom data pada Feature:
https://developers.google.com/kml/documentation/extendeddata

## 3. Controlled vocabulary awal

### Category

- `cctv`
- `cctv_cable`
- `junction_box`
- `fiber_optic`
- `lan`
- `network_device`
- `server`
- `nvr`
- `peripheral`
- `supporting_infrastructure`

### Asset type

Vocabulary harus disepakati dari data nyata. Alias sumber boleh banyak, tetapi
canonical value harus satu.

Contoh:

```text
"Outdoor PTZ Dome", "PTZ Outdoor", "CCTV PTZ"
-> cctv_ptz_outdoor
```

Alias mapping disimpan sebagai data konfigurasi versioned, bukan hard-coded
tanpa riwayat.

## 4. Relation model

```text
relation_id
dataset_version_id
source_asset_id
target_asset_id
relation_type
direction
path_asset_id?
source_geometry_ids[]
provenance
confidence
verification_status
verified_by?
verified_at?
evidence
```

### Provenance

- `explicit_kml_metadata`
- `approved_mapping`
- `spatial_inference`
- `manual_review`

### Verification status

- `confirmed`
- `candidate`
- `ambiguous`
- `rejected`
- `unresolved`

### Aturan tracing

Hanya `confirmed` yang masuk operational graph.

## 5. Strategi migrasi untuk KML aktual

KML aktual tidak memiliki ExtendedData. Migrasi dilakukan dua tahap.

### Tahap A - onboarding

1. Parse semua Folder, Placemark, Style, dan GroundOverlay.
2. Bentuk `source_feature_key` sementara dari source path, object ID jika ada,
   nama, tipe geometri, dan fingerprint geometri.
3. Kelompokkan folder yang belum terpetakan.
4. Buat mapping table untuk kategori/type.
5. Buat assignment Asset ID untuk object yang benar-benar asset.
6. Bedakan object asset, cable/path, view area, label, dan visual aid.
7. Generate candidate topology.
8. Review candidate penting.

### Tahap B - steady state

Pilih salah satu:

#### Opsi 1 - enriched KML

Tool migrasi menyuntikkan ExtendedData ke KML. Google Earth tetap dapat membuka
dan menyimpan data tersebut.

Kelebihan:

- satu source package;
- metadata ikut round-trip;
- paling selaras dengan proposal.

Risiko:

- perlu memastikan Google Earth workflow tidak menghapus metadata;
- editing massal ExtendedData kurang nyaman.

#### Opsi 2 - KML + companion asset registry

KML menyimpan geometri. CSV/database menyimpan Asset ID, metadata, dan relasi.

Kelebihan:

- metadata lebih mudah dikelola;
- validasi dan bulk update lebih mudah.

Risiko:

- perlu join key stabil;
- dua sumber harus dipublikasikan sebagai satu bundle/version.

Rekomendasi awal: gunakan enriched KML untuk minimal stable ID dan site ID,
sementara metadata inventaris yang sering berubah dapat berada pada companion
registry jika perusahaan mengizinkan.

## 6. Identity fallback

Fallback `folder-path + placemark-name` hanya boleh dipakai untuk onboarding.

Kelemahan:

- rename mengubah identitas;
- memindah folder mengubah identitas;
- nama duplikat memerlukan suffix berdasarkan urutan;
- perubahan urutan sumber dapat mengubah matching;
- diff antarversi menjadi tidak dapat dipercaya.

Dataset yang masih memakai fallback:

- boleh map-ready;
- belum inventory-ready;
- belum topology-ready kecuali edge sudah dipetakan ke Asset ID stabil.

## 7. GroundOverlay contract

KML aktual menggunakan GroundOverlay. KML mendefinisikan overlay sebagai gambar
yang didrape pada terrain melalui `LatLonBox` atau `gx:LatLonQuad`.

Field minimum:

- stable source reference;
- resource checksum;
- sanitized local resource path;
- north/south/east/west atau four corners;
- rotation;
- draw order;
- visibility;
- source folder/layer;
- dataset version.

Referensi:

- https://developers.google.com/kml/documentation/kmlreference
- https://www.ogc.org/standards/kml/

Resource eksternal tidak boleh diunduh otomatis. Resource lokal KMZ diperiksa,
disimpan immutable, dan disajikan melalui endpoint berotorisasi.

## 8. Readiness report yang ditampilkan ke admin

Jangan tampilkan ribuan issue sebagai daftar datar terlebih dahulu.

Ringkasan:

```text
Parse       READY
Map         READY WITH WARNINGS
Inventory   NOT READY
Topology    NOT READY

Coverage
- Stable Asset ID: 0 / 1.376
- Mapped folders: 84 / 167
- Confirmed topology nodes: ...
- Isolated nodes: ...
- Unresolved endpoints: ...
- Unsupported overlay/visual elements: ...
```

Lalu admin dapat drill down berdasarkan:

- site;
- folder;
- category;
- issue code;
- severity;
- geometry type;
- readiness dimension.

## 9. Publication policy

Publication profile:

### Map-only publication

Memerlukan parse-ready dan map-ready. UI menyembunyikan klaim inventaris dan
tracing yang belum siap.

### Operational topology publication

Memerlukan semua readiness dan threshold yang disepakati.

Profile harus terlihat jelas pada peta sehingga user tahu kemampuan data yang
sedang dibuka.

## 10. Regression fixture

Buat sample sintetis yang mewakili struktur aktual tanpa membawa nama dan
koordinat perusahaan:

- nested Folder sampai lima level;
- Point dan LineString;
- alias folder yang terpetakan dan tidak terpetakan;
- duplicate name;
- missing Asset ID;
- enriched ExtendedData;
- GroundOverlay lokal;
- endpoint confirmed;
- endpoint ambiguous;
- endpoint unresolved;
- line crossing yang bukan junction;
- candidate yang disetujui dan ditolak.

Fixture ini harus dipakai pada parser, adapter, topology, API, dan browser E2E.

## 11. Aturan audit silang

Parser, semantic classifier, dan topology engine memakai canonical contract yang
sama, tetapi tidak boleh mengambil alih tanggung jawab tahap lain.

- Parser hanya mengekstrak fakta dan provenance.
- Classifier menetapkan object role, network family, category, dan asset type.
- Topology engine hanya menghasilkan candidate dari classified canonical data.
- Konfirmasi administrator menghasilkan confirmed relation.
- Peta dan tracing hanya memakai confirmed relation untuk jalur operasional.

Perubahan parser wajib mengaudit ulang classifier dan topology jika mengubah:

- feature identity;
- geometri atau interpretasi koordinat;
- folder path;
- ExtendedData;
- style resolution;
- GroundOverlay/resource resolution;
- input site assignment.

Perubahan styling atau visibilitas layer UI tidak boleh mengubah canonical graph.

Setiap dataset version menyimpan:

```text
source_checksum
parser_version
normalizer_version
classification_rule_set_version
topology_rule_set_version
```

Dengan demikian, hasil derived dapat direproduksi dan perubahan candidate/edge
dapat dijelaskan.
