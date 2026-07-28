# SINERGI Dataset Version Validation Service

Validation service berada di
`src/import/dataset-validation-service.js` dan dijalankan setelah parser serta
adapter contract selesai. Service tidak menggantikan validasi upload, keamanan
KMZ, parser XML, atau runtime guard contract yang sudah ada.

## Alur

```text
file validation
-> safe KMZ extraction / XML parsing
-> KML import adapter
-> dataset version validation service
-> persistence sebagai valid atau invalid
-> aktivasi terpisah oleh Administrator
```

Error parser atau archive juga dinormalisasi melalui service menjadi hasil
validasi blocking. Dataset aktif tidak dibaca, ditulis, atau diganti oleh
pipeline ini.

## Bentuk hasil

Record dataset version mempunyai:

```js
{
  issues: [{
    id,
    datasetVersionId,
    severity,
    issueCode,
    sourceIssueCode,
    message,
    scope,
    canActivate,
    focus,
    details,
  }],
  validation: {
    schemaVersion: '1.0.0',
    status: 'valid' | 'invalid',
    canActivate: boolean,
    summary: {
      total,
      errors,
      warnings,
      information,
      blocking,
    },
    facets: {
      severity,
      scope,
      issueCode,
    },
    integrity: {
      datasetVersionId,
      branchId,
      activeVersionUnchanged,
      userVisible,
      publicationStatus,
    },
  },
}
```

`scope` memakai nilai `file`, `structure`, `asset`, `geometry`, `relation`,
`metadata`, `version_integrity`, atau `processing`. Facet dapat langsung dipakai
untuk summary card dan filter preview.

`focus` hanya memuat identifier kecil seperti `assetId`, `layerId`,
`geometryId`, `relationId`, source/target Asset ID, folder path, atau nama
Placemark. UI dapat memakai nilai tersebut untuk memusatkan object tanpa
menyimpan geometry ke issue.

## Severity dan aktivasi

- `error`: selalu `canActivate: false`;
- `warning`: selalu non-blocking;
- `information`: mencatat mapping atau normalisasi aman.

Dataset version hanya berstatus `valid` apabila tidak ada blocking issue.
Publication selalu tetap `unpublished`; service menolak record yang sudah
`active`, mempunyai metadata activation, atau sudah `published`.

Unresolved source/target relation selalu menjadi error. Self relation dan
duplicate semantic relation dicatat sebagai warning. Cycle diperbolehkan dan
dicatat sebagai information; traversal tetap wajib menggunakan visited set.

## Normalisasi yang dicatat

- penutupan ring Polygon yang valid;
- penerapan alias metadata;
- sanitasi description menjadi plain text;
- normalisasi MultiGeometry menjadi child geometry;
- pemilihan KML deterministik ketika KMZ mempunyai beberapa kandidat.

Tidak ada issue yang memperbaiki Asset ID, relasi, branch, atau koordinat secara
diam-diam.

## Konfigurasi

| Environment variable | Default | Fungsi |
|---|---|---|
| `SINERGI_REQUIRE_ASSET_NAME` | `false` | Menjadikan nama sumber wajib |
| `SINERGI_REQUIRED_METADATA_FIELDS` | kosong | Daftar field semantic wajib, dipisahkan koma |

Alias metadata, folder mapping, relation mapping, dan batas file tetap memakai
konfigurasi pipeline import yang sudah ada.
