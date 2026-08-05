# Guarded Topology Benchmark - 5 Agustus 2026

## Status

`complete` untuk sparse 10.000-path local guardrail; bukan sign-off load/SLO
production.

## Command dan environment

```text
cd backend
npm run benchmark:topology:guarded
```

Runner memakai budget runtime `60.000 ms` dan peak RSS `512 MiB`. Environment:
Node `v24.15.0`, Windows `win32 x64`, 16 CPU.

## Result

| Path | Fixture build | Runtime | Peak RSS | Candidate | Confirmed relation | Unresolved | Validation errors | Budget violations |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10.000 | 22,044 ms | 998,556 ms | 253,73 MiB | 0 | 0 | 20.000 | 0 | 0 |

Runner exit code `0`. Rule set `semantic-relation-engine/1.0.0`.

## Batas

Fixture ini sparse dan in-process. Hasil tidak membuktikan workload dense,
50.000 object stress, PostgreSQL I/O, worker/API concurrency, p95, atau SLO
production. Target kapasitas dan SLO tetap memerlukan persetujuan
Product/Infrastructure serta benchmark pada worker/database target.
