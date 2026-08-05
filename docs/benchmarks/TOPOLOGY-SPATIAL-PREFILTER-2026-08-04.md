# Topology spatial prefilter — 4 Agustus 2026

Status: `complete (code/regression scope)`.

## Implementasi

- Overlap linework tidak lagi membandingkan semua pasangan path. Pasangan
  kandidat dibuat dari segment grid sebelum pemeriksaan collinear overlap.
- Intersection candidate tidak lagi melakukan `nodes.filter(...)` global untuk
  setiap intersection. Junction dicari melalui node grid dengan radius query,
  lalu jarak presisi dan compatibility tetap diverifikasi.
- Output candidate, relation, graph, unresolved, dan baseline snapshot tetap
  dipertahankan.

File:

- `backend/src/topology/semantic-relation-engine.js`
- `backend/tests/semantic-relation-engine.test.js`
- `backend/tests/topology-baseline-snapshot.test.js`

## Evidence

- Spatial/regression tests: 17/17 lulus.
- Full backend test: 118/118 lulus.
- Lint: 59 file lulus.
- Build: 31 source file lulus.
- Sparse benchmark 1.000/2.000/4.000 path: 139,323/190,203/360,881 ms.
- Sparse benchmark 10.000 path: 908,972 ms, RSS 254,63 MiB, 0 candidate,
  0 validation error.

Command:

```text
cd backend
npm run benchmark:topology -- --sizes=10000
```

## Batas evidence

Benchmark ini adalah engine JavaScript in-process pada fixture sparse. Ini bukan
bukti query plan PostGIS, dense/intersection-heavy capacity, long-line stress,
50.000-object SLO, atau production worker capacity. Runtime PostgreSQL/PostGIS
belum tersedia di workspace (`psql`, `pg_dump`, `pg_restore`, Docker/Podman,
service, dan connection configuration tidak ditemukan).
