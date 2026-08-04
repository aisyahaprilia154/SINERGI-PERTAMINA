import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateRelationArtifacts,
  TOPOLOGY_RULE_SET_VERSION,
} from '../src/topology/semantic-relation-engine.js'

const FAMILIES = ['cctv', 'fiber_optic', 'lan', 'infrastructure']
const MATRIX = {
  cctv: {
    cctv: { nodeType: 'CCTV Camera', compatible: true },
    fiber_optic: { nodeType: 'OTB Junction', compatible: false },
    lan: { nodeType: 'Switch', compatible: false },
    infrastructure: { nodeType: 'Switch', compatible: true },
  },
  fiber_optic: {
    cctv: { nodeType: 'OTB Junction', compatible: true },
    fiber_optic: { nodeType: 'OTB Junction', compatible: true },
    lan: { nodeType: 'Switch', compatible: false },
    infrastructure: { nodeType: 'Switch', compatible: true },
  },
  lan: {
    cctv: { nodeType: 'CCTV Camera', compatible: true },
    fiber_optic: { nodeType: 'OTB Junction', compatible: false },
    lan: { nodeType: 'Switch', compatible: true },
    infrastructure: { nodeType: 'Switch', compatible: true },
  },
  infrastructure: {
    cctv: { nodeType: 'CCTV Camera', compatible: false },
    fiber_optic: { nodeType: 'OTB Junction', compatible: false },
    lan: { nodeType: 'Switch', compatible: false },
    infrastructure: { nodeType: 'Switch', compatible: true },
  },
}

test('representative network-family compatibility matrix is enforced', () => {
  FAMILIES.forEach((pathFamily) => {
    FAMILIES.forEach((nodeFamily) => {
      const expected = MATRIX[pathFamily][nodeFamily]
      const result = generateRelationArtifacts(bundleFor(
        pathFamily,
        nodeFamily,
        expected.nodeType,
      ))
      const compatible = result.candidates.some(({ candidateType }) => (
        candidateType === 'endpoint_device'
      ))
      assert.equal(
        compatible,
        expected.compatible,
        `${pathFamily} -> ${nodeFamily}`,
      )
    })
  })
})

function bundleFor(pathFamily, nodeFamily, nodeType) {
  const nodeSourceFeatureId = `feature:COMPAT-${nodeFamily}`
  const nodeGeometryId = `geometry:COMPAT-${nodeFamily}`
  const pathSourceFeatureId = `feature:PATH-${pathFamily}`
  const pathGeometryId = `geometry:PATH-${pathFamily}`
  const node = {
    assetId: `COMPAT-${nodeFamily}`,
    sourceFeatureId: nodeSourceFeatureId,
    siteId: 'site-compatibility',
    objectRole: 'device_node',
    networkFamily: nodeFamily,
    assetType: nodeType,
    category: nodeType,
    classificationStatus: 'classified',
    classificationEvidence: evidence(nodeType),
    geometryIds: [nodeGeometryId],
  }
  const path = {
    assetId: `PATH-${pathFamily}`,
    sourceFeatureId: pathSourceFeatureId,
    siteId: 'site-compatibility',
    objectRole: 'cable_path',
    networkFamily: pathFamily,
    assetType: `${pathFamily} path`,
    category: `${pathFamily} path`,
    classificationStatus: 'classified',
    classificationEvidence: evidence(pathFamily),
    geometryIds: [pathGeometryId],
  }
  return {
    datasetVersion: {
      id: 'dv-compatibility',
      sourceChecksum: `sha256:${'c'.repeat(64)}`,
    },
    site: 'site-compatibility',
    classifiedNodes: [node],
    classifiedPaths: [path],
    geometries: [
      {
        geometryId: nodeGeometryId,
        datasetVersionId: 'dv-compatibility',
        sourceFeatureId: nodeSourceFeatureId,
        geometryType: 'Point',
        coordinates: [110, -7],
        valid: true,
        geometryFingerprint: `fingerprint:${nodeGeometryId}`,
      },
      {
        geometryId: pathGeometryId,
        datasetVersionId: 'dv-compatibility',
        sourceFeatureId: pathSourceFeatureId,
        geometryType: 'LineString',
        coordinates: [[110, -7], [110.001, -7]],
        valid: true,
        geometryFingerprint: `fingerprint:${pathGeometryId}`,
      },
    ],
    explicitRelations: [],
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

function evidence(value) {
  return [{
    source: 'compatibility-fixture',
    observedValue: value,
    normalizedValue: value,
    ruleId: 'compatibility-matrix-fixture',
    weight: 1,
    explanation: 'Representative compatibility matrix fixture.',
  }]
}
