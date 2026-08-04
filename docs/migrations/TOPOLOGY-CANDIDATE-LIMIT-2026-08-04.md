# Topology candidate explosion guardrail — 4 Agustus 2026

Status: `complete (code and regression scope; capacity SLO pending)`.

## Contract

- Default hard limit: `50.000` raw candidates per topology bundle.
- Override: `config.topology.maxCandidateCount` atau environment
  `SINERGI_TOPOLOGY_MAX_CANDIDATES`.
- Limit berlaku lintas seluruh discovery stage: endpoint-device, inline-device,
  endpoint-endpoint, intersection, line-label, dan explicit metadata.
- Saat limit terlampaui engine melempar `topology_candidate_limit_exceeded`
  dengan HTTP/status contract `422` dan diagnostic:
  `attemptedCandidateCount`, `maxCandidateCount`, `stage`,
  `datasetVersionId`, dan `siteId`.
- Source geometry tidak dimutasi dan caller tidak menerima artifact parsial.

## Evidence

`backend/tests/semantic-relation-engine.test.js` menguji dua kandidat dengan
limit satu: engine berhenti pada stage `endpoint_device`, mengembalikan
diagnostic terstruktur, dan mempertahankan geometry input. Full verification
`156/156` test, lint `85` file, build `37` source file, dan `git diff --check`
lulus.

## Batas

Guardrail ini melindungi proses dari candidate explosion, tetapi belum
menetapkan kapasitas worker production. Dense/intersection-heavy 10.000 path,
50.000-object stress, API p95, dan SLO enterprise masih harus diuji dengan
fixture serta resource profile yang disetujui.
