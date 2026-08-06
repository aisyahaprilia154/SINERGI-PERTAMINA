# Dependency Security Audit - 5 Agustus 2026

## Status

`complete` untuk dependency audit lokal dan CI; container image scan tetap
pending karena repository belum mempunyai Dockerfile atau image build contract.

## Initial finding dan remediation

Full `npm audit --audit-level=high` menemukan satu high vulnerability pada
frontend melalui `postcss 8.5.16`, dengan advisory path-traversal/source-map.
`npm audit fix --package-lock-only --audit-level=high` memperbarui lockfile
secara minimum menjadi `postcss 8.5.25` dan `nanoid 3.3.17`; package manifest
aplikasi tidak berubah.

## Verification

Audit penuh setelah remediation:

```text
backend:  found 0 vulnerabilities
frontend: found 0 vulnerabilities
root:    found 0 vulnerabilities
```

CI workflow `/.github/workflows/dependency-security-audit.yml` menjalankan
`npm ci` dari lockfile dan `npm audit --audit-level=high` untuk root, backend,
dan frontend pada setiap push dan pull request. Workflow memakai permission
`contents: read`. Run GitHub Actions `30984124086` pada commit `eab6174`
selesai dengan status `success`.

## Boundary

Hasil ini tidak menggantikan SSO/RBAC review, secret scanning, container image
scan, runtime hardening, atau security approval enterprise. Container scan
harus ditambahkan ketika image build/Dockerfile dan registry target sudah
ditetapkan.
