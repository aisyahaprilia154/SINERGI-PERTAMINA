# HTTP Correlation ID — 4 Agustus 2026

Status: `complete (request/audit envelope; metrics and full log context pending)`.

## Perubahan

- Setiap response HTTP membawa header `x-correlation-id`.
- Header `x-correlation-id` dari client dipakai hanya jika memenuhi format aman
  alfanumerik dengan `.`, `_`, `:`, atau `-`, panjang 1–128 karakter; selain itu
  server membuat UUID v4 baru.
- Correlation ID diteruskan ke audit event HTTP untuk authorization denied,
  durable-job action, import accepted/rejected, dan source-file
  download/incident.
- JSON Lines audit menyimpan correlation ID yang tervalidasi dan tetap
  menyaring field sensitif dari `details`.
- Regression memastikan correlation ID yang dikirim client dipantulkan pada
  response dan disimpan pada authorization audit event; request tanpa header
  menerima UUID v4.

## Verifikasi

- `backend/tests/app-correlation-id.test.js` lulus.
- Full backend: `164/164` test lulus.
- Lint: `89` file JavaScript.
- Build: `37` source file.
- `git diff --check` lulus.

## Batas bukti

Checkpoint ini tidak mengklaim dashboard, metric backend, alert fault
injection, atau correlation context end-to-end pada worker/service event.
Konteks dataset version, job ID, dan graph revision masih harus dilengkapi
secara konsisten sebelum checklist observability enterprise ditandai penuh.
