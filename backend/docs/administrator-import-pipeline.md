# SINERGI Administrator KML/KMZ Import Pipeline

Service ini menyediakan pipeline server-side untuk menerima KML/KMZ sebagai
dataset version baru. Pipeline tidak mempunyai operasi aktivasi dan tidak pernah
menulis atau menghapus dataset aktif.

## Endpoint

### `GET /api/admin/import-config`

Mengembalikan kantor cabang, dataset tujuan per cabang, batas ukuran file,
format yang diterima, dan kemampuan cancellation workflow. Endpoint ini hanya
dapat dibaca oleh Administrator.

### `POST /api/admin/imports`

Request menggunakan `multipart/form-data`:

- `branchId`: identifier kantor cabang yang telah dikonfigurasi server;
- `datasetId`: dataset tujuan; wajib konsisten dengan kantor cabang jika dikirim;
- `versionName`: identitas versi maksimal 120 karakter;
- `versionNote`: catatan opsional maksimal 1.000 karakter;
- `officialSourceConfirmed`: nilai `true` jika Administrator telah memberikan
  konfirmasi pada UI;
- `file`: satu file `.kml` atau `.kmz`.

Header:

```text
Authorization: Bearer <server-configured-token>
```

Response sukses menggunakan status `202 Accepted`. Response memuat
`datasetVersion` berstatus `processing` dan `statusUrl`.

### `GET /api/admin/imports/:datasetVersionId`

Mengembalikan:

- metadata dan status dataset version;
- progress dan processing stage;
- ImportIssue;
- kandidat KML dan resource aman dari KMZ;
- `canActivate`.

Endpoint ini hanya melaporkan kesiapan aktivasi. Tidak ada endpoint aktivasi pada
implementasi pipeline ini.

## Authorization

Authorization diperiksa oleh server menggunakan token yang dikonfigurasi pada
`SINERGI_AUTH_TOKENS`. Role harus tepat `Administrator` secara case-insensitive.
Token atau role dari field multipart tidak pernah dipercaya.

Contoh konfigurasi development:

```powershell
$env:SINERGI_AUTH_TOKENS='{"replace-with-secret":{"id":"admin-1","role":"Administrator","name":"Administrator"}}'
$env:SINERGI_BRANCH_IDS='semarang'
$env:SINERGI_BRANCH_DATASETS='{"semarang":"dataset-semarang"}'
```

Jangan menyimpan token asli di source control.

## Konfigurasi batas

| Environment variable | Default |
|---|---:|
| `SINERGI_MAX_UPLOAD_BYTES` | 50 MiB |
| `SINERGI_MAX_ARCHIVE_ENTRIES` | 1000 |
| `SINERGI_MAX_EXTRACTED_BYTES` | 250 MiB |
| `SINERGI_MAX_COMPRESSION_RATIO` | 100 |
| `SINERGI_MAX_KML_BYTES` | 50 MiB |
| `SINERGI_REQUIRE_ASSET_NAME` | false |
| `SINERGI_REQUIRED_METADATA_FIELDS` | kosong |

Branch wajib tersedia di `SINERGI_BRANCH_IDS` dan harus mempunyai dataset ID
pada `SINERGI_BRANCH_DATASETS`.

Mapping relation ExtendedData dapat diberikan melalui
`SINERGI_RELATION_MAPPINGS`:

```json
[
  {
    "mode": "owner-target",
    "targetField": "connectedTo",
    "relationType": "connected-to",
    "separator": ",",
    "unresolvedSeverity": "warning"
  }
]
```

Alias metadata dan mapping folder dapat diubah tanpa mengganti parser:

```powershell
$env:SINERGI_METADATA_ALIASES='{"assetId":["asset_id","assetId","Asset ID","kode_aset"]}'
$env:SINERGI_FOLDER_MAPPINGS='[{"category":"Fiber Optic","aliases":["Fiber Optic","FO"]}]'
```

Default relation mapping hanya membaca metadata eksplisit `connected_to`, atau
pasangan `source_asset_id` dan `target_asset_id`. Mapping tidak pernah memakai
jarak, sentuhan visual geometri, kemiripan nama, atau kesamaan folder.

## Lifecycle

```text
multipart stream
→ temporary upload dengan nama internal acak
→ extension + MIME + size + signature validation
→ SHA-256 checksum
→ file sumber immutable dengan storage key internal
→ DatasetVersion processing
→ background job
→ KML parse / safe KMZ extraction
→ import contract adapter + validation
→ dataset version validation + issue facets
→ hasil dan ImportIssue disimpan
→ DatasetVersion valid atau invalid
```

Kegagalan setelah version dibuat menghasilkan status `invalid`. File sumber
tetap tersedia untuk audit. Active dataset tidak disentuh.

## Penyimpanan lokal

Default local persistence berada di `backend/.data`:

```text
.data/
  source-files/<dataset-version-id>/source-<uuid>.kml|kmz
  dataset-versions/<dataset-version-id>.json
  temporary-uploads/
  workspaces/
  audit/imports.jsonl
```

Nama file pengguna hanya disimpan sebagai metadata yang sudah disanitasi. Path
storage dibentuk dari UUID server dan tidak pernah memakai nama file pengguna.
Penulisan JSON version memakai temporary file dan atomic rename.

Implementasi storage ini cocok sebagai adapter lokal dan testable baseline.
Untuk deployment multi-instance, ganti repository/storage adapter dengan
database dan object storage yang mendukung transaksi serta immutability.

## KMZ security

- archive dibaca secara lazy/streaming;
- encrypted entry ditolak;
- path absolut, drive path, `..`, dan zip slip ditolak;
- jumlah entry, total extracted size, dan compression ratio dibatasi;
- archive corrupt ditolak;
- `doc.kml` root menjadi prioritas;
- kandidat lain diurutkan deterministik;
- semua kandidat diperiksa terhadap DTD/external entity;
- hanya KML dan resource `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` diekstrak;
- file lain dicatat sebagai issue dan tidak dieksekusi;
- workspace selalu dihapus melalui `finally`.

Resource hanya dicatat sebagai metadata. Pipeline tidak menyajikan atau
mengeksekusi resource tersebut.

## XML/KML security

- `DOCTYPE` dan `ENTITY` ditolak sebelum parsing;
- entity processing dinonaktifkan;
- NetworkLink tidak di-fetch;
- NetworkLink dan elemen unsupported dicatat sebagai ImportIssue;
- description dinormalisasi menjadi plain text tersanitasi dan source asli tetap
  tersedia untuk audit, tetapi tidak dirender sebagai HTML;
- script/HTML dari description tidak dirender atau dieksekusi;
- koordinat dibaca sebagai longitude, latitude, altitude optional tanpa
  membalik urutannya;
- longitude dan latitude diperiksa terhadap rentang KML;
- LineString wajib mempunyai minimal dua posisi;
- Polygon wajib mempunyai ring valid; ring valid yang belum tertutup dapat
  ditutup deterministik dan perubahan tersebut dicatat sebagai issue informasi.

## Cakupan parser

Parser memproses `Document`, Folder bertingkat, Placemark, ExtendedData
(`Data` dan `SimpleData`), Point, LineString, Polygon termasuk inner ring,
MultiGeometry, visibility, altitudeMode, Style, StyleMap, IconStyle, LineStyle,
dan PolyStyle.

Style sumber disimpan sebagai diagnostics/reference. Renderer map produksi tetap
memakai semantic style SINERGI dan tidak otomatis memakai seluruh warna KML.
Folder yang belum mempunyai mapping tidak dibuang: layer diberi kategori
`unmapped` dan menghasilkan warning untuk preview Administrator.

## Background processing

Repository sebelumnya belum memiliki job queue. Implementasi ini menggunakan
queue in-process dengan concurrency satu sehingga HTTP upload dapat segera
mengembalikan `202`.

Queue ini tidak durable saat process restart. Sebelum deployment multi-instance
atau workload besar, adapter queue perlu diganti dengan job system persisten.
Interface pipeline dan persistence sudah dipisahkan agar penggantian tersebut
tidak memengaruhi parser atau halaman map.

## Audit log

Event yang dicatat:

- authorization denied;
- upload accepted/rejected;
- processing started;
- processing completed;
- processing failed.

Audit log mencatat actor, waktu, branch, dataset version, checksum, hasil, dan
summary tanpa menyimpan token atau Authorization header.
