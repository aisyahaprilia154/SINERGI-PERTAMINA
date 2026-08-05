# Worker and service audit context evidence — 5 Agustus 2026

## Status

`passed (HTTP/worker/service context; external log shipping pending)`.

## Scope

Correlation context now propagates through the application boundaries that
create or mutate operational state:

- HTTP correlation IDs reach lifecycle activation/rollback/rejection,
  topology trace/review/mutation, and durable import/regeneration jobs;
- local background descriptors receive a generated `jobId`, matching the
  durable queue context contract;
- import worker audit events carry correlation ID, dataset version, job ID,
  and graph revision when the artifact has one;
- topology mutation, trace, regeneration, and dataset activation audit details
  carry correlation ID and the relevant graph revision before/after boundary;
- audit detail sanitization continues to reject token/password/secret keys.

## Validation

- Full backend test suite: `182/182`.
- Targeted topology/import context tests: `22/22`; lifecycle propagation is
  covered by the full suite.
- Lint: `96` JavaScript files.
- Build: `38` source files.
- `git diff --check`: pass.

The regression verifies deterministic HTTP correlation forwarding and reads the
completed import worker audit event to confirm the correlation ID, generated
job ID, and graph revision are persisted without exposing credentials.

## Boundary

This is application audit context evidence. It does not claim centralized log
shipping, retention policy, SIEM integration, production SLO, or organization
security approval.
