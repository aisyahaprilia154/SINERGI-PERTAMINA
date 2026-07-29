# Evidence-Preserving KML/KMZ Parser

Implementasi parser backend mengikuti pipeline:

```text
package safety
-> deterministic KML selection
-> structural parsing
-> canonical normalization
-> style/resource resolution
-> semantic classification
-> readiness and coverage
-> TopologyInputBundle
```

## Batas tanggung jawab

Parser mempertahankan source geometry, metadata, style, overlay, dan resource
evidence. Parser tidak mengambil URL eksternal, tidak membuat relasi berdasarkan
jarak, dan selalu menghasilkan `topologyReadiness = not_applicable`.

Hasil lama (`layers`, `assets`, `geometries`, `relations`) masih dibuat untuk
kompatibilitas. Kontrak baru disimpan terpisah pada:

- `sourceFeatures`
- `sourceGeometries`
- `sourceMetadataEntries`
- `sourceOverlays`
- `sourceResources`
- `classifiedObjects`
- `topologyInputBundle`
- `parserCoverage`
- `readiness`
- `parserVersions`

`sourceFeatureId`, `assetId`, dan `geometryId` adalah identity berbeda.
Fallback onboarding identity di `TopologyInputBundle` bukan Asset ID bisnis.

## Readiness

Nilai readiness adalah `ready`, `ready_with_warnings`, `not_ready`, atau
`not_applicable`.

- Parse: package, root, XML, coverage, dan blocking parser issue.
- Map: geometry/bounds, critical unsupported element, serta overlay resource.
- Inventory: stable Asset ID dan semantic mapping untuk asset operasional.
- Topology: selalu `not_applicable`; relation engine menjadi decision owner.

## Endpoint baca

Endpoint berikut membutuhkan Administrator:

```text
GET /api/dataset-versions/:id/readiness
GET /api/dataset-versions/:id/source-features
GET /api/dataset-versions/:id/geometries
GET /api/dataset-versions/:id/overlays
GET /api/dataset-versions/:id/classification-issues
```

## Versioning

Setiap import mencatat source checksum serta versi parser, normalizer,
classifier, metadata alias, folder mapping, dan style mapping. Perubahan pada
canonical input harus diperlakukan sebagai pemicu regenerasi hasil relation
engine pada tahap algoritma relasi.
