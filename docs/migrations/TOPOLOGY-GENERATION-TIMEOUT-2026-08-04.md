# Topology generation timeout — 4 Agustus 2026

Status: `complete (engine generation contract; worker/API SLO pending)`.

## Contract

- Default cooperative generation timeout: `60.000 ms`.
- Override eksplisit: `config.topology.maxGenerationMilliseconds` atau
  `SINERGI_TOPOLOGY_MAX_GENERATION_MS`.
- Budget dimulai sebelum topology preparation dan diperiksa setelah linework /
  spatial index serta di antara discovery stage dan candidate append.
- Timeout menghasilkan `topology_generation_timeout`, HTTP/status contract
  `504`, dan diagnostic `elapsedMilliseconds`, `timeoutMilliseconds`, `stage`,
  candidate count/limit, dataset version, serta site.
- Engine melempar sebelum mengembalikan result sehingga caller tidak menerima
  partial artifact; input geometry tetap tidak dimutasi.

## Evidence

`backend/tests/semantic-relation-engine.test.js` memakai 2.000 path dengan
timeout `1 ms`, memverifikasi error code/status/diagnostic, dan memastikan
geometry input tetap sama. Full verification: `158/158` test, lint `85` file,
build `37` source file, dan `git diff --check` lulus.

## Batas

Timeout ini adalah guardrail sinkron pada engine. Cancellation worker,
durable-job partial artifact cleanup, concurrent API p95, dan production
capacity/SLO masih pending.
