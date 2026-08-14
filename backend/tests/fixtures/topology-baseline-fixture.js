import { TOPOLOGY_RULE_SET_VERSION } from '../../src/topology/semantic-relation-engine.js'

export const BASELINE_FIXTURE_VERSION = 'topology-baseline-fixture/1.0.0'

export function createBaselineTopologyBundle() {
  const nodes = [
    node('SW-01', 'infrastructure', 'Switch', [110, -7]),
    node('SW-02', 'infrastructure', 'Switch', [110.001, -7]),
  ]
  const paths = [
    pathObject('LAN-01', 'lan', 'LAN Cable', [
      [110, -7],
      [110.001, -7],
    ], 'dv-baseline-fixture'),
  ]

  return {
    datasetVersion: {
      id: 'dv-baseline-fixture',
      sourceChecksum: `sha256:${'b'.repeat(64)}`,
    },
    site: 'site-baseline',
    classifiedNodes: nodes.map(({ object }) => object),
    classifiedPaths: paths.map(({ object }) => object),
    geometries: [...nodes, ...paths].map(({ geometry }) => geometry),
    explicitRelations: [{
      explicitRelationEvidenceId: 'explicit-baseline-01',
      datasetVersionId: 'dv-baseline-fixture',
      sourceReference: 'SW-01',
      targetReference: 'SW-02',
      relationType: 'connected-to',
      direction: 'undirected',
    }],
    topologyPolicy: {
      requireJbTermination: false,
    },
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

export function createBenchmarkTopologyBundle(pathCount) {
  const datasetVersionId = `dv-benchmark-${pathCount}`
  const paths = Array.from({ length: pathCount }, (_, index) => {
    const latitude = -7 + index * 0.002
    const networkFamily = ['cctv', 'fiber_optic', 'lan', 'infrastructure'][index % 4]
    return pathObject(
      `BENCH-${String(index + 1).padStart(5, '0')}`,
      networkFamily,
      `${networkFamily} benchmark path`,
      [[110, latitude], [110.0002, latitude]],
      datasetVersionId,
    )
  })

  return {
    datasetVersion: {
      id: datasetVersionId,
      sourceChecksum: `sha256:${String(pathCount).padStart(64, '0')}`,
    },
    site: 'site-benchmark',
    classifiedNodes: [],
    classifiedPaths: paths.map(({ object }) => object),
    geometries: paths.map(({ geometry }) => geometry),
    explicitRelations: [],
    topologyPolicy: {
      requireJbTermination: false,
    },
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
    topologyRuleSetVersion: TOPOLOGY_RULE_SET_VERSION,
  }
}

function node(assetId, networkFamily, assetType, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-baseline',
      objectRole: 'device_node',
      networkFamily,
      assetType,
      category: assetType,
      classificationStatus: 'classified',
      classificationEvidence: evidence(assetType),
      interfaceDefinitions: [{
        interfaceType: 'lan_port',
        ordinal: 1,
        serviceDomain: 'data',
        mediaType: 'copper_lan',
      }],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-baseline-fixture',
      sourceFeatureId,
      geometryType: 'Point',
      coordinates,
      valid: true,
      geometryFingerprint: `fingerprint:${assetId}`,
    },
  }
}

function pathObject(assetId, networkFamily, assetType, coordinates, datasetVersionId) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: assetId.startsWith('BENCH-') ? 'site-benchmark' : 'site-baseline',
      objectRole: 'cable_path',
      networkFamily,
      assetType,
      category: assetType,
      classificationStatus: 'classified',
      classificationEvidence: evidence(assetType),
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId,
      sourceFeatureId,
      geometryType: 'LineString',
      coordinates,
      valid: true,
      geometryFingerprint: `fingerprint:${assetId}`,
    },
  }
}

function evidence(value) {
  return [{
    source: 'folder',
    observedValue: `/Baseline/${value}`,
    normalizedValue: value,
    ruleId: 'baseline-fixture',
    weight: 0.8,
    explanation: 'Deterministic hardening baseline evidence.',
  }]
}
