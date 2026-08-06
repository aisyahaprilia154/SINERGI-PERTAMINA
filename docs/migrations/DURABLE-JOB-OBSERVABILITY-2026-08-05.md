# Durable job observability evidence — 5 Agustus 2026

## Status

`passed (local durable queue runtime; multi-instance production metrics
pending)`.

## Scope

The durable queue now reports the following into the shared in-process metrics
registry:

- accepted jobs and idempotency deduplication;
- `running`, `retry_wait`, `succeeded`, `cancelled`, and dead-letter state
  transitions;
- execution duration when a terminal/retry timestamp is available;
- active worker count;
- queue depth by job type and active queue status (`queued`, `running`, or
  `retry_wait`).

Metrics failures are swallowed at the queue boundary and cannot change job
claim, completion, retry, or dead-letter correctness.

## Validation

- Targeted queue/metrics tests: `3/3`.
- Full backend test suite: `182/182`.
- Lint: `96` JavaScript files.
- Build: `38` source files.
- `git diff --check`: pass.

The regression creates one local durable queue, processes one job, submits the
same idempotency input twice, and verifies one accepted job, one deduplication,
running/succeeded transitions, one duration observation, zero active queue
depth after completion, and no dataset ID in metrics labels.

## Boundary

Queue depth is a local repository snapshot. This evidence does not claim
cross-instance aggregation, production dashboard delivery, database I/O
metrics, alert routing, or Operations/Security SLO approval.
