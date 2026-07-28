# SINERGI KML/KMZ Import Data Contract

Contract hasil import berada pada:

- `src/domain/kml-import-contract.js`
- `src/adapters/kml-import-adapter.js`

Project menggunakan JavaScript, sehingga typing menggunakan JSDoc dan runtime
validation ringan. Contract tidak mengubah parser, renderer map, routing, atau
UI yang sudah ada.

## Batas tanggung jawab

Pipeline yang diharapkan:

```text
file asli KML/KMZ
→ penyimpanan file immutable + checksum
→ parser XML/ZIP
→ kml-import-adapter
→ runtime validation
→ persistence dataset version
→ aktivasi terpisah
→ adapter/renderer network map
```

`kml-import-adapter` hanya menormalisasi output parser. Adapter tidak:

- membaca XML atau membuka archive KMZ;
- menulis file ke storage;
- menulis record ke database;
- mengaktifkan dataset version;
- mengubah object output parser;
- menyimpulkan relasi dari jarak atau kedekatan geometry;
- mengirim data langsung ke renderer map.

## Input adapter

```js
adaptKmlImportResult({
  datasetVersion,
  parserOutput,
  mapping,
})
```

`datasetVersion` minimal menyediakan:

- identitas dataset, version, dan branch;
- metadata file sumber;
- ukuran dan checksum;
- identitas dan waktu import;
- validation, publication, dan lifecycle status.

`sourceStorageKey` dapat belum tersedia pada tahap preview. Persistence service
wajib menyimpan file sumber asli secara immutable dan mengisi reference tersebut
sebelum dataset version dapat diaktifkan. Runtime validator menolak version
berstatus `active` yang tidak mempunyai `sourceStorageKey`.

`parserOutput` dapat menyediakan:

- `folders`, termasuk `children`/`folders` dan `placemarks` di dalamnya;
- `placemarks` atau `features` pada root;
- `relations` atau `metadata.relations`;
- `styles` dan `styleMaps` sebagai referensi style sumber;
- `issues` dari parser;
- `unsupportedElements`;
- `comparison` apabila perbandingan terhadap version sebelumnya sudah dilakukan.

Adapter tidak mengubah array, object, geometry, atau ExtendedData dari input.

## Output adapter

```js
{
  contractVersion,
  datasetVersion, // termasuk ImportSummary
  layers,         // AssetLayer[]
  assets,         // AssetNode[]
  geometries,     // AssetGeometry[]
  relations,      // AssetRelation[]
  issues,         // ImportIssue[]
  sourceStyles,   // Style/StyleMap sumber untuk diagnostics
}
```

Semua layer, asset, relation, dan issue memakai `datasetVersionId` yang sama.
Semua asset juga memakai `branchId` dari DatasetVersion. Validator memeriksa
isolasi version, hierarchy layer, ID duplikat, dan seluruh referensi silang.

## Geometry

Geometry parser dinormalisasi sebagai:

- `Point` → `point`;
- `LineString` → `line_string`;
- `Polygon` → `polygon`;
- `MultiGeometry`/`GeometryCollection` → `multi_geometry`.

Nilai dan urutan coordinate tidak diubah. Coordinate normalisasi disimpan di
`coordinates`, sementara object parser asli disalin ke `sourceGeometry`.
`bounds` dihitung sebagai `[west, south, east, north]` tanpa mengubah coordinate.

Geometry diagram 2D tidak termasuk dalam contract ini dan tidak boleh disimpan
ke `AssetGeometry`.

## ExtendedData dan Asset ID

Adapter menerima ExtendedData object maupun daftar `{ name, value }`.

- Nilai normalisasi tersedia pada `properties.extendedData`.
- Representasi parser tetap tersedia pada `properties.sourceExtendedData`.
- Key dan nilai asli tersedia pada `properties.sourceProperties`.
- Metadata semantic tersedia pada `properties.semanticMetadata`.
- Jejak alias yang dipakai tersedia pada `properties.metadataMapping`, berisi
  target field, source key, nilai asli, dan nilai normalisasi.
- Asset ID default dapat dibaca dari `asset_id`, `assetId`, `Asset ID`,
  `kode_aset`, serta alias kompatibilitas sebelumnya.
- Seluruh alias dapat ditentukan melalui `mapping.metadataAliases`.

Placemark tanpa Asset ID menghasilkan issue `missing_asset_id` yang memblokir
aktivasi. Asset ID duplikat menghasilkan `duplicate_asset_id`; record pertama
dipertahankan dan record berikutnya tidak dimasukkan sebagai AssetNode.

## Relasi

Relasi hanya dibuat dari:

1. `parserOutput.relations` atau `parserOutput.metadata.relations`; atau
2. ExtendedData dengan rule mapping yang diberikan secara eksplisit.

Contoh rule yang terdokumentasi:

```js
{
  relationMappings: [{
    mode: 'owner-target',
    targetField: 'connectedTo',
    relationType: 'connected-to',
    separator: ',',
    unresolvedSeverity: 'warning',
  }],
}
```

Rule `explicit-pair` dapat membaca `sourceAssetId`, `targetAssetId`, dan
`relationType` dari metadata semantic yang sudah melalui alias mapping.
Koordinat dan jarak antar-asset tidak pernah digunakan untuk membentuk relation.
Reference yang tidak tersedia pada dataset version aktif dicatat sebagai issue
dan relation tersebut tidak dinormalisasi.

## Folder hierarchy

Setiap Folder menjadi AssetLayer. Child folder memakai `parentLayerId`, sedangkan
`sourceFolderPath` mempertahankan hierarchy seperti `/CCTV/Area A`.

Placemark tanpa folder ditempatkan pada layer fallback `Tanpa folder`. Layer
fallback tidak dihitung sebagai source folder pada ImportSummary.

## Issue dan aktivasi

Issue parser dan normalisasi disimpan sebagai ImportIssue. Elemen KML yang belum
didukung harus masuk melalui `unsupportedElements` dan menjadi issue
`unsupported_kml_element`; elemen tersebut tidak boleh diabaikan diam-diam.

`canActivate: false` menandai issue yang memblokir aktivasi. Adapter menetapkan:

- `validationStatus: invalid` dan `status: invalid` jika ada blocking issue;
- `validationStatus: valid` dan `status: valid` jika normalisasi selesai tanpa
  blocking issue.

Aktivasi tetap merupakan business operation terpisah dan tidak dilakukan oleh
adapter.

## ImportSummary

Jumlah folder, placemark, asset, geometry, relation, error, dan warning dihitung
dari hasil import. Nilai `newAssets`, `updatedAssets`, `unchangedAssets`, dan
`removedAssets` hanya diambil dari `parserOutput.comparison`.

Jika comparison belum tersedia, keempat nilai tersebut adalah `0`; adapter tidak
menebak perubahan terhadap dataset version lain.

## TODO integrasi sumber

- Lengkapi alias metadata per format KML kantor cabang apabila key di lapangan
  berbeda dari default.
- Lengkapi mapping folder dan mapping relation per konvensi sumber yang sudah
  didokumentasikan.
- Tentukan kebijakan severity untuk relation target yang belum tersedia.
- Tambahkan dukungan elemen namespace `gx:*` hanya setelah contoh sumber dan
  kebutuhan bisnisnya tersedia; saat ini elemen unsupported dicatat sebagai
  issue.
- Simpan version baru dan active-version pointer dalam transaksi terpisah.
- Jangan menghapus file sumber atau version sebelumnya ketika version baru aktif.
