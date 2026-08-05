# Accuracy Artifact Gate - 5 Agustus 2026

## Status

`complete` untuk kontrak runtime fail-closed; `production evaluation approval`
tetap pending.

## Tujuan

Menutup jalur bypass yang sebelumnya dapat mengaktifkan spatial auto-confirm
hanya dengan memasukkan angka held-out precision dan path accuracy melalui
config/env. Checkpoint ini tidak membuat atau mengesahkan gold set production.

## Enforcement

`evaluateAccuracyGate` sekarang menolak approval jika salah satu kondisi berikut
gagal:

- artifact bukan schema `1.0.0` atau statusnya bukan `approved`;
- identity, gold-set version/checksum, approval actor/timestamp, evaluation
  timestamp, atau expiry tidak lengkap;
- rule-set version atau engine build SHA tidak cocok dengan runtime;
- site atau network family artifact tidak cocok dengan topology scope;
- artifact belum dievaluasi, sudah expired, atau timestamp-nya berada di masa
  depan;
- held-out sample kurang dari `200`, precision kurang dari `0.99`, path accuracy
  kurang dari `0.95`, atau `falseComponentMergeCount` bukan `0`.

Environment variables `SINERGI_TOPOLOGY_HELD_OUT_PRECISION` dan
`SINERGI_TOPOLOGY_PATH_ACCURACY` tidak lagi dibaca sebagai approval source.
Readiness menyimpan status gate, evaluation ID, metrik artifact, dan blocking
reasons. Scope network family memakai family pada path; node junction yang
berlabel `infrastructure` tidak memalsukan scope family path.

## Regression evidence

- config test: raw accuracy env metrics tidak mengisi approval fields;
- accuracy-gate test: artifact approved, expired, draft, build mismatch, dan
  sample di bawah minimum;
- semantic-engine test: missing artifact tetap tidak mengonfirmasi spatial
  candidate; artifact approved yang cocok dapat mengonfirmasi dan menempelkan
  `accuracyEvaluationId`;
- full backend test: `175/175` pass;
- lint: `91` JavaScript files pass;
- build: `37` source files pass;
- `git diff --check`: pass.

## Batas dan tindak lanjut

Belum ada gold set production 200--300 endpoint, durable evaluator job,
database-backed artifact persistence/signature, atau approval organisasi.
Sampai seluruhnya tersedia, default dan runtime tanpa artifact tetap
fail-closed dan tidak boleh dipakai sebagai bukti GO auto-confirm production.
