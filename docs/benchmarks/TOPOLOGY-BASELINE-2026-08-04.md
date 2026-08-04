# Baseline topology benchmark — 4 Agustus 2026

Status: baseline reproducible, bukan bukti kapasitas enterprise.

Command:

```text
cd backend
npm run benchmark:topology
```

Fixture dan command tersimpan di repository:

- `backend/tests/fixtures/topology-baseline-fixture.js`
- `backend/tests/fixtures/topology-baseline.snapshot.json`
- `backend/tests/topology-baseline-snapshot.test.js`
- `backend/benchmarks/topology-baseline.mjs`

Rule set: `semantic-relation-engine/1.0.0`.

| Path | Runtime | RSS | Candidate | Confirmed relation | Unresolved | Validation errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1.000 | 348.137 ms | 67.52 MiB | 0 | 0 | 2.000 | 0 |
| 2.000 | 672.489 ms | 92.07 MiB | 0 | 0 | 4.000 | 0 |
| 4.000 | 2.742826 s | 144.51 MiB | 0 | 0 | 8.000 | 0 |

Interpretasi checkpoint:

- Baseline dapat dijalankan ulang dengan fixture yang sama dan snapshot yang
  sama.
- Dataset benchmark sengaja sparse dan tidak mengukur dense/intersection-heavy.
- Hasil ini belum dibandingkan dengan target 10.000/50.000 objek dan belum
  menjadi sign-off SLO.
- Runtime masih baseline engine lama; task spatial prefilter berikutnya harus
  mempertahankan snapshot dan menurunkan pertumbuhan runtime pada fixture
  tersebar.

Target awal yang menunggu persetujuan Product/Infrastructure:

- candidate list p95 < 500 ms;
- confirm/reject API p95 < 1 s sampai transaksi diterima;
- full regeneration 10k < 60 s pada worker target;
- lost review 0;
- job hilang setelah restart 0;
- duplicate relation akibat retry 0.
