# Semantic Constrained Relation Engine

Implementasi ini membangun relasi operasional dari hasil parser KML/KMZ tanpa
menyamakan kedekatan geometris dengan konektivitas.

## Invarian keselamatan

- Hanya relasi `confirmed` yang boleh masuk graph aktif dan network tracing.
- Inferensi jarak, endpoint, inline, dan intersection selalu menjadi kandidat
  review secara default.
- LineString adalah evidence rute, bukan edge graph operasional secara langsung.
- Dua garis yang berpotongan tidak terhubung tanpa evidence junction yang
  terklasifikasi.
- Feature `unknown` dan `visual` tidak menjadi sumber relasi operasional.
- `candidate`, `ambiguous`, `rejected`, dan `revoked` tidak boleh masuk graph.
- Regenerasi mempertahankan keputusan review dan audit history.
- Source geometry tidak dimodifikasi oleh proses inferensi.

## Alur data

1. Parser menghasilkan bundle kanonik yang versioned.
2. Engine memvalidasi dataset version, geometry version, stable ID, referensi,
   dan eligibility feature.
3. Spatial index membatasi pasangan yang layak diperiksa.
4. Rule engine membentuk kandidat dengan evidence, score, margin, dan rule-set
   version.
5. Explicit KML metadata yang valid dapat menjadi relasi confirmed.
6. Reviewer mengonfirmasi, menolak, melewati, memilih alternatif target, atau
   mencabut relasi.
7. Graph dibangun ulang hanya dari relasi confirmed.
8. Readiness dan topology summary dipersistensikan bersama dataset version.

## Candidate explosion guardrail

Candidate discovery mempunyai hard limit default `50.000` kandidat per bundle.
Limit dapat diubah secara eksplisit melalui `SINERGI_TOPOLOGY_MAX_CANDIDATES`
atau `config.topology.maxCandidateCount`. Jika limit terlampaui, engine berhenti
dengan error `topology_candidate_limit_exceeded` sebelum menghasilkan artifact
parsial; diagnostic menyebut stage discovery, dataset version, site, jumlah
yang dicoba, dan limit. Nilai ini adalah safety guardrail, bukan persetujuan
kapasitas produksi atau pengganti load test.

Generation juga mempunyai cooperative timeout default `60.000 ms`, yang dapat
diubah melalui `SINERGI_TOPOLOGY_MAX_GENERATION_MS` atau
`config.topology.maxGenerationMilliseconds`. Timeout diperiksa di antara
discovery stage dan kandidat; jika terlampaui engine melempar
`topology_generation_timeout` (`504`) dengan stage, elapsed/limit, dan dataset
context, tanpa mengembalikan artifact parsial.

## Jenis kandidat

- `endpoint_device`: endpoint path ke perangkat kompatibel.
- `inline_device`: perangkat yang terletak di bagian dalam path.
- `endpoint_endpoint`: gap kecil antar-path satu family dengan arah berlanjut.
- `intersection_with_junction`: perpotongan path yang memiliki junction
  terklasifikasi.
- `explicit_metadata`: relasi dari metadata sumber; valid evidence dapat langsung
  dikonfirmasi sesuai policy.

Score kandidat menggabungkan evidence jarak, kompatibilitas family, orientasi,
posisi endpoint/inline, dan evidence junction. Score tidak mengubah status
menjadi confirmed kecuali spatial auto-confirm secara eksplisit diaktifkan dan
gate akurasi terpenuhi.

## Review dan audit

Endpoint API mengikuti prefix aplikasi `/api`:

- `GET /api/dataset-versions/:id/topology/summary`
- `GET /api/dataset-versions/:id/topology/candidates`
- `GET /api/dataset-versions/:id/topology/graph`
- `POST /api/dataset-versions/:id/topology/regenerate`
- `POST /api/topology/candidates/:id/confirm`
- `POST /api/topology/candidates/:id/reject`
- `POST /api/topology/candidates/:id/skip`
- `POST /api/topology/candidates/:id/select-target`
- `POST /api/topology/relations/:id/revoke`

Mutasi review hanya tersedia bagi administrator. Reject, select-target, dan
revoke mewajibkan alasan. Audit event menyimpan aktor, waktu, state sebelum dan
sesudah, alasan, evidence, serta rule-set version.

Full regeneration pada endpoint admin dikirim ke durable job
`regenerate_full_topology` dan dipantau melalui `/api/admin/jobs/:jobId`.
Idempotency key mencegah request duplikat membuat job atau topology run ganda;
worker mendaftarkan handler saat startup agar job dapat dipulihkan setelah
restart.

## Readiness dan evaluasi

Dataset tetap `not_ready` bila stable ID belum valid, terdapat dangling
reference, graph invalid, atau hasil held-out belum membuktikan ambang akurasi.
Spatial auto-confirm default-nya mati. Mengaktifkannya memerlukan precision
held-out minimal 99%, path accuracy sesuai konfigurasi, dan approval policy.

`evaluateTopologyAccuracy` menerima gold set versioned dengan split
`calibration` dan `held_out`. Laporannya mencakup precision, recall, automatic
coverage, distance strata, path accuracy, component accuracy, dan false
component merge. Gold set tidak diturunkan dari keputusan review pada dataset
yang sedang dievaluasi.
