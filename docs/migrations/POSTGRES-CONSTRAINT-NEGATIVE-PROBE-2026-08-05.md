# PostgreSQL Constraint Negative Probe - 5 Agustus 2026

## Status

`passed (local PostgreSQL live constraint contract)`.

## Command

```text
cd backend
npm run db:constraint-negative
```

The command requires `SINERGI_DATABASE_URL` in the credentialed PowerShell
session. It does not print or request a password itself.

## Safety boundary

- Schema and PostGIS are checked before the probe.
- Foreign-key and duplicate-candidate inserts run inside named savepoints.
- Each savepoint is rolled back, followed by an outer transaction rollback.
- A residue query verifies the generated probe candidate count is zero.
- The runner only passes when PostgreSQL returns SQLSTATE `23503` for the
  dataset-version foreign key and `23505` for the composite candidate unique
  key.

## Local verification

- Contract test: `2/2` pass.
- Full backend test: `179/179` pass.
- Lint: `93` JavaScript files pass.
- Build: `37` source files pass.

## Live evidence

Credentialed terminal returned `result: "passed"` against PostgreSQL/PostGIS
`3.6.2` with all 13 operational tables present. The runner's pass condition
requires both probes to return the expected PostgreSQL SQLSTATE, the outer
transaction to be rolled back, and the residue query to return
`persistentRowsCreated: 0`. The plan item “Foreign key dan unique constraint
diuji” is now closed for the local live schema.
