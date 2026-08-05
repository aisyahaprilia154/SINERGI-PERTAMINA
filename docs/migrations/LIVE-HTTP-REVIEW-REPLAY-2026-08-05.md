# Live PostgreSQL HTTP review replay - 5 Agustus 2026

## Status

`passed (credentialed local PostgreSQL pilot rerun)`.

## Result

Runner `npm run db:http-review-replay` selesai dengan:

```json
{
  "result": "passed",
  "datasetVersionId": "live-http-review-7dd5ca47f08348d89188743ce0605343",
  "candidateId": "candidate:4d6e80b1a61a2744bc53367f",
  "concurrentStatuses": [200, 409],
  "winnerCount": 1,
  "staleConflictCount": 1,
  "auditEventCount": 1,
  "confirmedRelationCount": 2,
  "validatedGraphRevisionCount": 1,
  "activeGraphRevisionCount": 0,
  "jsonPrimaryUsed": false
}
```

Satu concurrent review menjadi winner dan satu request stale ditolak. Satu
validated graph revision terbentuk melalui PostgreSQL primary, sedangkan
`activeGraphRevisionCount: 0` expected karena fixture tetap unpublished dan
tidak boleh dipublikasikan sebagai graph aktif.

## Boundary

Evidence ini membuktikan HTTP review concurrency dan projection pada pilot
PostgreSQL lokal. Belum membuktikan multi-instance production, reviewer fleet,
API p95, failover, atau enterprise SLO/approval.
