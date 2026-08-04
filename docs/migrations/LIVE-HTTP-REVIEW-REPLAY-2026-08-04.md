# Live PostgreSQL HTTP review replay - 4 Agustus 2026

Status: `passed (pilot fixture)`.

## Scope

- PostgreSQL/PostGIS lokal menjadi primary repository; JSON primary tidak
  digunakan.
- Runner membuat dataset fixture unik, memuat candidate melalui HTTP API, lalu
  mengirim dua confirm concurrent dengan graph/candidate revision yang sama.
- Dataset fixture berstatus valid tetapi unpublished, sehingga graph baru hanya
  boleh berstatus `validated` dan tidak boleh menjadi `active`.

## Hasil

```json
{
  "result": "passed",
  "datasetVersionId": "live-http-review-b49c5c026da142bfb5d646dbe1d51c02",
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

Satu request menjadi winner dan commit candidate/relation/graph/audit. Request
kedua membaca snapshot yang sudah stale dan menerima `409`. Audit event
append-only membuat dataset evidence dipertahankan; runner tidak mencoba
menonaktifkan trigger atau menghapus audit secara paksa.

## Defect yang ditemukan dan ditutup

Replay awal menemukan candidate/summary API mengeluarkan revision graph hasil
normalisasi tracing, sedangkan mutation membandingkan revision graph mentah.
Akibatnya mutation valid selalu menerima `409 stale_topology_review`.

`reviewSnapshot()` sekarang menggunakan normalisasi graph yang sama dengan API.
Regression test membuktikan revision dari candidate API dapat langsung dipakai
oleh mutation HTTP dan berubah setelah review sukses.

## Batas evidence

- Fixture masih kecil dan tidak membuktikan SLO production-sized.
- Belum membuktikan 20 reviewer pada candidate berbeda.
- Belum menguji retry request setelah network timeout.
- Belum menguji concurrent confirm/revoke atau full regeneration/review.
- Belum membuktikan restart/recovery worker dan API multi-instance.
