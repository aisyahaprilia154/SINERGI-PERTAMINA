import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateRelationArtifacts,
  TOPOLOGY_RULE_SET_VERSION,
} from '../src/topology/semantic-relation-engine.js'

test('deterministic geometry fuzz corpus handles world edges, long lines, and invalid bounds', () => {
  const validCases = [
    lineCase('FUZZ-ANTIMERIDIAN', [
      [179.999, -0.0001],
      [179.9999, 0.0001],
    ]),
    lineCase('FUZZ-POLE', [
      [-179.999, 89.999],
      [-179.998, 89.9999],
    ]),
    lineCase('FUZZ-LONG', Array.from({ length: 2049 }, (_, index) => [
      110 + Math.sin(index / 17) * 0.0002,
      -7 + index * 0.000001,
    ])),
  ]

  validCases.forEach((candidate) => {
    const bundle = topologyBundle(candidate)
    const sourceBefore = structuredClone(bundle.geometries)
    const result = generateRelationArtifacts(bundle)
    assert.equal(result.validation.summary.errors, 0)
    assert.equal(result.candidates.some(hasNonFiniteNumber), false)
    assert.deepEqual(bundle.geometries, sourceBefore)
  })

  const invalidCases = [
    [180.000001, 0],
    [-180.000001, 0],
    [0, 90.000001],
    [0, -90.000001],
  ]
  invalidCases.forEach((coordinates, index) => {
    const bundle = topologyBundle(lineCase(
      `FUZZ-INVALID-${index}`,
      [[110, -7], coordinates],
    ))
    const sourceBefore = structuredClone(bundle.geometries)
    const result = generateRelationArtifacts(bundle)
    assert.equal(result.candidates.length, 0)
    assert.ok(result.eligibilityIssues.some(({ issueCode, severity }) => (
      issueCode === 'path_geometry_ineligible' && severity === 'error'
    )))
    assert.deepEqual(bundle.geometries, sourceBefore)
  })
})

function topologyBundle({ object, geometry }) {
  return {
    datasetVersion: {
      id: 'dv-geometry-fuzz',
      sourceChecksum: `sha256:${'f'.repeat(64)}`,
    },
    site: 'site-fuzz',
    classifiedNodes: [],
    classifiedPaths: [object],
    geometries: [geometry],
    explicitRelations: [],
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

function lineCase(assetId, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-fuzz',
      objectRole: 'cable_path',
      networkFamily: 'fiber_optic',
      assetType: 'Fiber Optic',
      category: 'Fiber Optic',
      classificationStatus: 'classified',
      classificationEvidence: [{
        source: 'fuzz-fixture',
        observedValue: assetId,
        normalizedValue: 'fiber_optic',
        ruleId: 'fuzz-fixture',
        weight: 1,
        explanation: 'Deterministic geometry fuzz fixture.',
      }],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-geometry-fuzz',
      sourceFeatureId,
      geometryType: 'LineString',
      coordinates,
      valid: true,
      geometryFingerprint: `fingerprint:${assetId}`,
    },
  }
}

function hasNonFiniteNumber(value) {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber)
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasNonFiniteNumber)
  }
  return false
}
