# Dense Topology Guarded Benchmark - 5 Agustus 2026

## Status

`complete` untuk dense local guardrail; bukan sign-off API/worker SLO
production.

## Command dan environment

```text
cd backend
npm run benchmark:topology:dense-guarded
```

Runner memakai 10.000 device node dalam area rapat, 10 path probe, hard
candidate limit `50.000`, budget runtime `60.000 ms`, dan RSS `512 MiB`.
Environment: Node `v24.15.0`, Windows `win32 x64`, 16 CPU. Rule set
`semantic-relation-engine/1.0.0`.

## Result

```json
{
  "objectCount": 10000,
  "nodeCount": 10000,
  "pathCount": 10,
  "durationMs": 1153.649,
  "observedRssMiB": 184.13,
  "outcome": "candidate_guardrail_triggered",
  "errorCode": "topology_candidate_limit_exceeded",
  "attemptedCandidateCount": 50001,
  "maxCandidateCount": 50000,
  "stage": "endpoint_device",
  "budgetViolations": [],
  "pass": true
}
```

Dense workload berhenti fail-closed pada hard limit yang terdiagnosis; runner
tidak mengembalikan artifact parsial dan tidak mengalami out-of-memory.

## Boundary evidence

Hasil ini menutup guardrail dense local, bukan SLO. Belum membuktikan API atau
worker concurrency, PostgreSQL I/O, multi-instance behavior, p95, atau target
capacity production. SLO dense harus ditetapkan dan diuji pada environment
production target.
