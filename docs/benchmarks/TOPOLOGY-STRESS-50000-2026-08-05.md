# Topology Stress Benchmark - 50.000 Path - 5 Agustus 2026

## Status

`complete` untuk stress guardrail lokal sparse in-process; bukan sign-off
capacity atau SLO production.

## Command dan environment

```text
cd backend
npm run benchmark:topology -- --sizes=50000 --max-duration-ms=120000 --max-rss-mib=768
```

Environment: Node `v24.15.0`, Windows `win32 x64`, 16 CPU. Rule set
`semantic-relation-engine/1.0.0`.

## Result

| Path | Fixture build | Runtime | Peak RSS | Candidate | Confirmed relation | Unresolved | Validation errors | Budget violations |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50.000 | 122,509 ms | 6.480,388 ms | 548,28 MiB | 0 | 0 | 97.002 | 0 | 0 |

Runner exit code `0`; process selesai tanpa out-of-memory. Budget runner
`120.000 ms / 768 MiB` menghasilkan `violations: []`.

## Batas evidence

Fixture ini sparse dan in-process. Evidence tidak membuktikan workload dense,
intersection-heavy, long-line, API/worker concurrency, PostgreSQL I/O,
multi-instance behavior, p95, atau SLO production. Target budget production
tetap harus disetujui dan diuji pada topology, database, dan worker target.
