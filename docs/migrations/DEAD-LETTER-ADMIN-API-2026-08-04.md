# Dead-letter admin API — 4 Agustus 2026

Status: `complete (JSON durable API regression scope; PostgreSQL live evidence
pending)`.

## Contract

- `GET /api/admin/jobs/:jobId` menampilkan state `dead_letter`, progress,
  attempt count, error code/summary, dan metadata operasional yang aman.
- Payload job tidak dikembalikan pada public response sehingga source key atau
  secret tidak bocor.
- `POST /api/admin/jobs/:jobId/retry` hanya menerima terminal state yang
  retryable menurut repository; dead-letter kembali ke `queued`, reset attempt
  dan error fields, lalu audit event dicatat.
- Kedua route tetap Administrator-only.

## Evidence

`backend/tests/durable-job-api.test.js` membuat poison job durable, memindahkan
job ke `dead_letter`, membaca state melalui API, lalu retry melalui API sampai
state `queued`. Full verification: `157/157` test, lint `85` file, build `37`
source file, dan `git diff --check` lulus.

## Batas

Evidence ini memakai JSON durable repository sebagai contract test. Dead-letter
retention, PostgreSQL live operator workflow, alerting/dashboard, dan approval
policy production tetap pending.
