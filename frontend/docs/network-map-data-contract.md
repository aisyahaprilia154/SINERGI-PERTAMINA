# SINERGI Network Map Data Contract

Contract ini menjadi batas antara output parser/dataset service dan komponen
visual halaman network map. Implementasinya berada di:

- `src/domain/network-map-contract.js`
- `src/adapters/network-map-adapter.js`

Contract menggunakan JSDoc dan runtime validation ringan karena project saat
ini menggunakan JavaScript, bukan TypeScript.

## Input adapter

`adaptNetworkMapData({ parserOutput, context })` menerima:

1. `context`, atau `parserOutput.context`/`parserOutput.activeContext`, yang
   minimal menyediakan `branchId` dan `datasetVersionId`. Bentuk lama
   `datasetId` dan `version` juga diterima sebagai alias non-destruktif.
2. Koleksi aset dari salah satu field berikut:
   - `assets`;
   - `features`;
   - `nodes`;
   - `placemarks`;
   - atau GeoJSON `FeatureCollection`.
3. Relasi eksplisit dari:
   - `relations`;
   - `assetRelations`;
   - `metadata.relations`;
   - atau `network.edges`.
4. Network eksplisit dari `networks` atau `metadata.networks`.

Adapter tidak mengubah object input. Geometry disalin dengan urutan dan nilai
koordinat yang sama. Field `x/y` pada data demo lama disimpan sebagai
`properties.displayPosition` dengan `coordinateSpace: "viewport-normalized"`
dan tidak dianggap sebagai longitude/latitude.

Record dengan `branchId` atau `datasetVersionId` eksplisit yang berbeda dari
context aktif dilewati dan dicatat pada `warnings`.

## Output adapter

Adapter mengembalikan:

```js
{
  contractVersion,
  context,   // MapContext
  assets,    // AssetNode[]
  relations, // AssetRelation[]
  networks,  // AssetNetwork[]
  warnings,  // string[]
}
```

`geometry` mengikuti bentuk GeoJSON-compatible dan dapat bernilai `null` ketika
parser tidak memberikan geometry. Bounds, jika tersedia, menggunakan urutan
`[west, south, east, north]`.

Referensi silang memakai identitas aset bisnis:

- `AssetRelation.sourceAssetId`, `targetAssetId`, dan `pathAssetId` merujuk ke
  `AssetNode.assetId`;
- `AssetNetwork.assetIds` juga merujuk ke `AssetNode.assetId`;
- `AssetNode.id` tetap menjadi identitas record/node pada dataset.

Adapter menerima referensi parser yang memakai `id` atau `assetId`, kemudian
menormalisasikannya ke `assetId` pada output.

`validateNetworkMapData()` memeriksa bentuk record, ID duplikat, kesamaan
branch/dataset version, serta referensi asset/relation/network.

## Fallback ketika relasi tidak tersedia

Adapter tidak pernah menyimpulkan relasi berdasarkan jarak atau kedekatan
marker. Jika metadata relation dan `network.edges` tidak tersedia:

- `relations` menjadi array kosong;
- semua asset tetap dipertahankan;
- asset yang tidak tercantum dalam network ditempatkan pada
  `network:unassigned`;
- network fallback tidak menciptakan relation baru.

Dengan demikian aset tanpa relasi tetap dapat ditampilkan oleh renderer.

## TODO metadata KML

Sebelum parser produksi dihubungkan, struktur metadata KML/KMZ perlu menetapkan:

- sumber stabil untuk `assetId`, `category`, `type`, dan `layerId`;
- penempatan `branchId` dan `datasetVersionId`;
- format relation, arah relation, dan `relationType`;
- cara mereferensikan kabel/path melalui `pathAssetId`;
- mapping `Folder`, `ExtendedData`, dan `MultiGeometry`;
- penanganan Placemark tanpa ID dan ID duplikat;
- kebijakan altitude, `altitudeMode`, serta `gx:Track`;
- apakah bounds berasal dari parser atau dihitung oleh map service.

Sampai metadata tersebut disepakati, adapter hanya memakai field relation yang
eksplisit dan tidak melakukan inferensi spasial.
