# Observability dan Incident Response Runbook - 5 Agustus 2026

## Status

`draft-ready` untuk handoff Operations; dashboard, centralized log shipping,
threshold final, dan incident drill production masih membutuhkan approval
Infrastructure/Operations.

## Metrics scrape

Aktifkan metrics hanya pada runtime yang dilindungi Administrator:

```text
SINERGI_METRICS_ENABLED=true
```

`GET /metrics` harus di-scrape melalui secret bearer token yang dikelola
secret manager. Token tidak boleh dimasukkan ke repository, dashboard URL,
atau label metrics. Scrape target wajib memakai TLS/restricted network pada
production.

## Dashboard panels dan query awal

Query berikut adalah baseline observability; threshold final mengikuti SLO
perusahaan yang disetujui.

| Panel | PromQL baseline |
|---|---|
| Request rate | `sum(rate(topology_api_requests_total[5m])) by (route,method)` |
| HTTP error ratio | `sum(rate(topology_api_request_errors_total[5m])) / clamp_min(sum(rate(topology_api_requests_total[5m])), 1)` |
| Candidate API p95 | `histogram_quantile(0.95, sum(rate(topology_api_request_duration_seconds_bucket{route=~".*topology.*"}[5m])) by (le))` |
| Queue depth | `sum(topology_job_queue_depth{status=~"queued|retry_wait"}) by (job_type)` |
| Active workers | `sum(topology_job_workers_active) by (job_type)` |
| Dead-letter | `sum(increase(topology_job_dead_letter_total[15m])) by (job_type)` |
| Process RSS | `process_resident_memory_bytes` |
| In-flight requests | `topology_api_requests_in_flight` |

Metric names must be checked against the live exposition before dashboard
publication; no panel may expose dataset IDs, candidate IDs, tokens, or raw
request paths.

## Alert baseline

Create alerts only after Product/Infrastructure approve the values:

- HTTP error ratio above the approved error budget for 10 minutes;
- candidate/review p95 above the approved target for 10 minutes;
- queue depth increasing continuously or retry queue older than the approved
  age;
- any dead-letter increase;
- active worker count zero while queued work exists;
- process RSS above the approved memory guardrail;
- metrics scrape absent for two consecutive intervals.

Every alert notification must include service, environment, route/job type,
first-seen time, correlation ID link if available, and runbook URL. It must not
include credentials or raw source data.

## Fault drill

Local evidence already covers the primitives:

1. Record a synthetic HTTP 500 and verify
   `topology_api_request_errors_total` increments.
2. Submit a retryable durable job and verify transition/duration metrics.
3. Submit a poison job and verify dead-letter metric plus operator retry.
4. Verify queue depth returns to zero after completion.

Production fault injection requires a change window, rollback owner, and
approved target. Never restart PostgreSQL or delete queue data as an ad-hoc
alert test.

## Incident response

1. Capture alert time, environment, route/job type, and correlation ID.
2. Check `/health`, metrics scrape, queue state, worker activity, and recent
   deployment SHA.
3. If candidate/review writes are unsafe, disable mutation traffic or return
   to map-only/manual review; do not enable auto-confirm.
4. For queue growth, stop adding load, inspect retry/dead-letter state, and
   preserve job/audit evidence before retrying.
5. For database errors, fail closed, preserve the active graph pointer, and
   follow the approved backup/failover runbook.
6. Record timeline, impact, evidence, containment, and recovery decision in
   the incident system.

## Production handoff checklist

- [ ] Prometheus scrape and dashboard deployed with restricted access.
- [ ] Final p95/error/queue/RSS thresholds approved.
- [ ] Central log shipping and retention/SIEM policy enabled.
- [ ] Fault drill completed in staging with rollback owner.
- [ ] Operations and Security sign off the runbook.
