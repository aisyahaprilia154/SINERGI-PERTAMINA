# Topology Publication Validation Gate - 5 Agustus 2026

## Status

`complete` untuk full-regeneration runtime contract; review-specific publication
gate dan PostgreSQL multi-instance rollout tetap pending.

## Perubahan

`TopologyService.regenerate()` sekarang memvalidasi artifact sebelum audit
regeneration dan sebelum repository update. Error pada validation atau
eligibility tidak boleh mengganti graph revision aktif. Error tersebut menjadi
`topology_artifact_validation_failed` dengan `retryable=false`, sehingga poison
artifact tidak diputar ulang tanpa perubahan input.

## Regression evidence

Test `regeneration keeps the previous graph active when the new artifact is
invalid` menambahkan duplicate linework pada input. Test membuktikan:

- regenerasi ditolak dengan error validation yang terstruktur;
- tidak ada audit event regeneration palsu;
- topology graph lama tetap identik;
- candidate collection dan topology run lama tetap identik.

Full backend verification: `177/177` test, lint `91` file, build `37` source
file, dan `git diff --check` lulus. Targeted topology-service suite lulus
`17/17`.

## Batas

Gate ini menutup full-regeneration path pada repository runtime saat ini.
Review mutation, active graph pointer PostgreSQL, concurrent publication lintas
instance, dan production rollout masih memerlukan evidence terpisah.
