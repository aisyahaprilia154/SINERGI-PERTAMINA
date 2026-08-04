# Baseline topology benchmark — 4 Agustus 2026

Status: baseline reproducible dan fixture/command repository tervalidasi ulang,
bukan bukti kapasitas enterprise.

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

Re-run fixture/command pada 4 Agustus 2026 (`npm run benchmark:topology --
--sizes=1000,2000,4000`) menghasilkan JSON valid dengan `validationErrors: 0`
untuk seluruh ukuran:

| Path | Runtime | RSS | Candidate | Unresolved |
|---:|---:|---:|---:|---:|
| 1.000 | 139,718 ms | 71,19 MiB | 0 | 2.000 |
| 2.000 | 175,117 ms | 95,30 MiB | 0 | 4.000 |
| 4.000 | 246,174 ms | 148,80 MiB | 0 | 8.000 |

Re-run ini membuktikan command dan fixture dapat dijalankan dari repository;
angka tersebut tidak mengubah batas evidence terhadap workload dense,
production-sized, atau target SLO.

Target awal yang menunggu persetujuan Product/Infrastructure:

- candidate list p95 < 500 ms;
- confirm/reject API p95 < 1 s sampai transaksi diterima;
- full regeneration 10k < 60 s pada worker target;
- lost review 0;
- job hilang setelah restart 0;
- duplicate relation akibat retry 0.
