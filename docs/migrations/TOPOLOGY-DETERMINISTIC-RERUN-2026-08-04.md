# Topology deterministic rerun — 4 Agustus 2026

Status: `complete (in-process artifact contract; cross-worker persistence
pending)`.

`backend/tests/semantic-relation-engine.test.js` menjalankan topology job dua
kali dengan input bundle clone, rule-set yang sama, dan `generatedAt` yang sama,
lalu membandingkan seluruh artifact menggunakan deep equality. Candidate,
confirmed relation, graph revision, validation, readiness, dan summary harus
identik.

Full verification: tiga full-suite run berurutan masing-masing `161/161` test
lulus; lint `86` file, build `37` source file, dan `git diff --check` juga
lulus.

Batas: test ini belum membuktikan durable job retry lintas process/instance,
PostgreSQL persistence, atau deduplication saat artifact sudah tersimpan.
