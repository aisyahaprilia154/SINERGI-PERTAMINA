# Topology compatibility matrix — 4 Agustus 2026

Status: `complete (representative family contract; production vocabulary
coverage pending)`.

`backend/tests/topology-compatibility-matrix.test.js` menguji seluruh 16
pasangan path/node family untuk `cctv`, `fiber_optic`, `lan`, dan
`infrastructure`. Representative node types memverifikasi same-family gate,
approved cross-family links, dan incompatible-family rejection.

Full verification: `163/163` test, lint `88` file, build `37` source file, dan
`git diff --check` lulus.

Batas: matrix ini memakai satu representative type per family. Variasi
controlled vocabulary, site-specific mapping, dan production label distribution
masih harus ditambah pada approved data contract.
