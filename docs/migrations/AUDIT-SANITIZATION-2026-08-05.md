# Recursive audit sanitization - 5 Agustus 2026

## Status

`passed (local JSON/PostgreSQL audit sinks; production retention/shipping
pending)`.

## Scope

Audit detail sekarang disanitasi secara recursive pada JSON Lines dan
PostgreSQL sink. Key yang mengandung `token`, `authorization`, `password`, atau
`secret` dibuang pada semua nested object/array level. Circular value diberi
marker bounded dan kedalaman nested dibatasi agar audit tidak dapat mengalami
rekursi tak berujung.

## Verification

- Targeted audit/security suite: `4/4`.
- Full backend test suite: `184/184`.
- Lint: `98` JavaScript files.
- Build: `39` source files.
- `git diff --check`: pass.

Regression mencakup nested secret pada JSON Lines, nested secret pada JSONB
PostgreSQL, circular value, correlation audit HTTP, dan existing append-only
PostgreSQL audit contract.

## Boundary

Sanitizer ini tidak membuktikan centralized log shipping, retention/SIEM,
source-data classification, secret scanning, atau security approval enterprise.
