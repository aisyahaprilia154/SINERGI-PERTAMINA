# Baseline Implementasi — 2 Agustus 2026

Dokumen ini mengunci kondisi dataset dan batas implementasi sebelum pilot Pengapon dikerjakan.

## Dataset aktif

- Dataset: `dataset-semarang`
- Branch: `semarang`
- Active version: `dv-475afc04-0d7a-49aa-8212-2a7803ea0c72`
- Nama versi: `doc · 29 Jul 2026`
- Active pointer revision: `bc375290-6cd3-4c50-9f3d-86e62984dd3e`
- Sumber: `doc.kml`
- Diaktifkan: `2026-07-29T04:10:30.840Z`

Snapshot baseline dari record aktif:

| Ukuran | Nilai |
| --- | ---: |
| Asset | 1.376 |
| Geometry | 1.376 |
| Point | 824 |
| LineString | 552 |
| Relation persisted | 0 |
| Node topology graph | 623 |
| Edge topology graph | 0 |
| Candidate topology | 1 |
| Confirmed relation pada record lama | 100 |
| Ambiguous | 35 |
| Unresolved | 651 |

Readiness saat baseline: `parse=ready_with_warnings`, `map=not_ready`, `inventory=not_ready`, dan `topology=not_ready`. Blocking reason topology yang tersimpan adalah `stable_identity_coverage`, `confirmed_graph_invalid`, dan `held_out_accuracy_not_proven`.

Read model sekarang menormalkan angka topology lama menjadi `confirmedRelationCount=100`, `confirmedPathAttachmentCount=20`, `confirmedPathContinuationCount=80`, dan `confirmedDeviceEdgeCount=0`. Jadi angka 100 tidak lagi ditampilkan sebagai operational device edge.

## Implementasi pada checkpoint ini

1. Baseline existing map/topology work dibekukan pada commit `2d70ce2`.
2. Map runtime sekarang membaca kontrak readiness dan fail-closed untuk topology yang belum siap:
   - menampilkan `Topology-ready: No`;
   - menampilkan pesan `Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.`;
   - menonaktifkan tracing dan diagram 2D;
   - tidak mengoperasikan edge topology ketika readiness belum `ready`.
3. Identity canonical ditambahkan sebagai kontrak versioned `canonical-asset-identity/1.0.0` dengan alias stable/source/onboarding/legacy/sourceFeatureId.
4. Record lama dimigrasikan saat dibaca melalui resolver: legacy path/name dan onboarding-ID tetap dapat dipakai sebagai alias, sedangkan consumer menerima satu `canonicalAssetId`.
5. Validasi menolak duplicate canonical ID, duplicate alias lintas asset, dan referensi source feature yang hilang.

## Pilot target

Pilot pertama tetap **FT Pengapon — Semarang**. Kriteria sukses pilot:

- satu asset nyata dapat dicari dan dibuka detailnya;
- identitas source, onboarding, legacy, dan canonical menunjuk asset yang sama;
- upstream/downstream dapat ditelusuri hanya setelah edge terkonfirmasi;
- diagram 2D dan map menggunakan node/edge canonical yang sama;
- bila syarat belum terpenuhi, UI tetap menyatakan topology belum siap dan tidak mengklaim tracing valid.

Pembangunan ulang topology Pengapon, review candidate, dan pembuktian held-out accuracy belum dianggap selesai pada checkpoint ini.

## Hasil regenerasi candidate Stage 2

Candidate queue active version diregenerasi pada `2026-08-02T00:00:00.000Z` dengan auto-confirm spatial/metadata dimatikan untuk run ini. Keputusan review lama dipertahankan agar audit history tidak hilang.

- Candidate queue: 135 item (`candidate=1`, `ambiguous=35`, `confirmed=99` dari keputusan lama).
- Confirmed relation: 100.
- Confirmed path attachment: 20.
- Confirmed path continuation: 80.
- Confirmed operational device edge: 0.
- Unresolved endpoint: 651.
- Pengapon menyentuh 8 relation, semuanya `path_continuation`; belum ada device edge.

Artinya pilot sudah memiliki antrean dan bukti review yang dapat ditindaklanjuti, tetapi belum memenuhi syarat untuk mengaktifkan tracing perangkat. Tombol tracing/diagram tetap disabled sampai ada device edge canonical yang tervalidasi.
