# Local HTTP observability metrics evidence — 5 Agustus 2026

## Status

`passed (local runtime contract; production dashboard and alerting pending)`.

## Scope

The backend now has an in-process Prometheus exposition registry and a protected
`GET /metrics` endpoint. Metrics are disabled unless
`SINERGI_METRICS_ENABLED=true` is set. When enabled, the endpoint requires the
Administrator authorization contract already used by the API.

The local registry records:

- HTTP request count, status, normalized route, method, and duration histogram;
- HTTP server-error count and in-flight request gauge;
- process user/system CPU, RSS, heap used, and uptime.

Route labels use bounded templates such as `/api/topology/candidates/:id/:action`;
dataset IDs, candidate IDs, tokens, and raw request paths are not emitted as
metric labels.

## Validation

- Targeted metrics tests: `2/2`.
- Full backend test suite: `181/181`.
- Lint: `95` JavaScript files.
- Build: `38` source files.
- `git diff --check`: pass.

The regression test verifies that the endpoint is `404` when disabled, returns
`401` without authorization when enabled, and returns Prometheus text only to an
Administrator. It also verifies that a secret candidate ID does not appear in
the rendered metrics.

## Boundary

This checkpoint does not claim production dashboard availability, queue depth
accuracy across multiple workers, database I/O metrics, fault-injection alert
tests, log shipping, or enterprise SLO approval. Those remain separate
production/Operations gates.
