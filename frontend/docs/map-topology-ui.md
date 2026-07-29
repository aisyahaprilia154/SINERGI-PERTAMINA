# Peta Aset dan Topologi Cabang

Implementasi UI memakai satu dataset version, Asset ID, dan confirmed
operational graph yang sama untuk dua projection:

- `/map`: lokasi fisik menggunakan MapLibre dan koordinat longitude/latitude
  canonical.
- `/topology`: hubungan logis menggunakan ELK layered layout di Web Worker dan
  SVG orthogonal renderer.
- `/admin/topology-review`: queue candidate, evidence, perbandingan alternatif,
  keputusan review, dan riwayat.

## Invarian client

- Client tidak menjalankan topology inference.
- Peta, topology, diagram, dan tracing hanya memakai confirmed graph dari
  backend.
- Filter hanya mengubah opacity/presentation; jumlah node dan edge canonical
  tidak berubah.
- Candidate dan ambiguous hanya ditampilkan sebagai dashed review connector
  bagi administrator.
- Selected Asset ID dan trace reference dibawa melalui URL ketika berpindah
  projection.

## Peta geografis

MapLibre memakai GeoJSON Point, LineString, dan Polygon dari parser. Urutan
layer adalah GroundOverlay, area, cable path, asset point, candidate connector,
selection/trace, dan label. Tanpa approved basemap, UI menampilkan blank
geographic surface dengan pemberitahuan; tidak ada jalan atau label fiktif.

GroundOverlay yang valid dibaca dari resource KMZ melalui endpoint berotorisasi
dan diposisikan menggunakan LatLonBox atau gx:LatLonQuad. Rotation LatLonBox
diterapkan sebelum koordinat dikirim ke MapLibre ImageSource.

## Topology

ELK berjalan di worker dengan layered/right/orthogonal options. Layout di-cache
berdasarkan dataset version, confirmed edge identity, dan grouping mode.
Progressive disclosure tersedia melalui:

- category dimming;
- focus selected node dan neighbors;
- label auto/all/off;
- component/network/building/folder grouping;
- zoom, fit, minimap, dan accessible neighbor list;
- trace highlight;
- export SVG dan PNG.

## Candidate review

Queue memprioritaskan ambiguous berdampak tinggi, root/core candidate, score
tinggi, unresolved endpoint, lalu candidate lain. Filter tersedia untuk status,
network family, candidate type, score, distance, dan pencarian reference.

Confirm, select-target, reject, skip, dan revoke memanggil API backend.
Confirmed graph dimuat ulang setelah mutation berhasil. Reject, select-target,
dan revoke memerlukan alasan. Riwayat keputusan dan regeneration run
ditampilkan tanpa memasukkan candidate ke graph sebelum konfirmasi.
