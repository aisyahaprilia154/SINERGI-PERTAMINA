# Topology geometry fuzz corpus — 4 Agustus 2026

Status: `complete (deterministic corpus; adversarial production fuzzing
pending)`.

`backend/tests/topology-geometry-fuzz.test.js` covers valid LineString near the
antimeridian and poles, a 2.049-vertex long line, and out-of-range longitude /
latitude values. Valid inputs produce no validation error, no non-finite
candidate number, and do not mutate source geometries. Invalid bounds fail
closed as `path_geometry_ineligible` blocking eligibility issues rather than
being repaired or silently clamped.

Full verification: `162/162` test, lint `87` file, build `37` source file, dan
`git diff --check` lulus.

Batas: corpus deterministic ini bukan randomized property/fuzz campaign,
dateline-wrapping semantics, 50.000-object stress, atau production geometry
distribution evidence.
