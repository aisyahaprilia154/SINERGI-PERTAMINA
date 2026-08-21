# Peta Aset dan Diagram Topologi

Implementasi UI memakai satu dataset version, Asset ID, dan confirmed
operational graph yang sama untuk dua projection:

- `/map`: lokasi fisik menggunakan MapLibre dan koordinat longitude/latitude
  canonical.
- `/topology` (alias `/topologi`): workspace Diagram Topologi penuh untuk
  hubungan logis terkonfirmasi.
- `/admin/topology-review`: bookmark lama diarahkan ke Peta Aset; review
  kandidat dilakukan dari layer administrator di Diagram Topologi.

## Invarian client

- Client tidak menjalankan topology inference.
- Peta geografis tetap menjadi projection utama lokasi fisik. Diagram Topologi
  adalah projection logis terpisah dan tidak memakai koordinat peta untuk
  menentukan posisi node.
- Dataset aktif, `datasetVersionId`, dan `branchId` menjadi scope wajib.
  Parameter URL yang valid dipertahankan saat berpindah view: `area`,
  `selectedAssetId`, `selectedEdgeId`, `traceFrom`, `traceTo`,
  `networkFamily`, serta `layers=admin`.
- Node hanya berasal dari aset dalam scope dan edge hanya berasal dari
  confirmed graph/API. Mounting relation tidak dijadikan edge topologi.
- Candidate/ambiguous/unresolved tidak masuk graph operasional; layer tersebut
  default mati dan hanya tersedia bagi administrator.
- Filter network family meredupkan konteks lain, sehingga graph utuh tetap
  terlihat. Pergantian area mengosongkan selection dan trace.

## Peta geografis

MapLibre memakai GeoJSON Point, LineString, dan Polygon dari parser. Urutan
layer adalah GroundOverlay, area, cable path, asset point, candidate connector,
selection/trace, dan label. Tanpa approved basemap, UI menampilkan blank
geographic surface dengan pemberitahuan; tidak ada jalan atau label fiktif.

GroundOverlay yang valid dibaca dari resource KMZ melalui endpoint berotorisasi
dan diposisikan menggunakan LatLonBox atau gx:LatLonQuad. Rotation LatLonBox
diterapkan sebelum koordinat dikirim ke MapLibre ImageSource.

## Diagram Topologi

- Diagram menggunakan layout hierarchy yang statis dan deterministic.
- Node dan kanvas tidak dapat di-drag; teknisi menavigasi dengan area,
  pencarian, scroll, zoom, dan Fit.
- Tier dibaca dari atas ke bawah: core, distribusi, akses, lalu endpoint.

Workspace terdiri dari kontrol scope di kiri, canvas graph logis di tengah, dan
inspector di kanan. Hierarki dirender top-down sebagai root/core → distribution
→ junction → endpoint. Komponen dipisahkan dalam lane, edge memakai rute
orthogonal, dan seluruh hasil layout deterministik.

Root dimuat dari endpoint roots terlebih dahulu. Bila unavailable, role
`root/core`, semantic role, degree, lalu ID dipakai sebagai anchor layout.
Anchor fallback selalu diberi label bahwa ia bukan root operasional.

Fitur yang tersedia:

- pencarian Asset ID, nama, tipe, lokasi, hostname, dan metadata jalur;
- area dan network-family scope tanpa menghapus node/edge;
- selected node/edge, direct relations, provenance, geometry/path metadata,
  dan tautan kembali ke Peta Aset;
- tracing melalui API confirmed graph dengan graph revision check;
- zoom, fit, scroll, accessible node list, export SVG/PNG;
- Web Worker untuk graph besar dengan fallback layout dan cache berdasarkan
  dataset/version/branch/area/graph revision;
- section **Aset tanpa relasi** tanpa edge sintetis, plus panel unresolved
  terpisah untuk administrator.
- relasi mounting fisik divisualisasikan sebagai bubble berwarna lembut yang
  membungkus perangkat pada tiang yang sama, bukan sebagai koneksi jaringan.

## Candidate review

Candidate yang ditampilkan administrator tetap dashed amber dan tidak ikut
tracing. Unresolved ditampilkan sebagai marker merah dan tidak diperlakukan
sebagai node atau edge palsu. Confirm/reject memanggil API backend dengan
alasan; setelah mutation, graph, roots, candidate layer, dan layout dimuat
ulang sebelum state workspace diperbarui.
