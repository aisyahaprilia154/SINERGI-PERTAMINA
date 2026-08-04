import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateRelationArtifacts,
  TOPOLOGY_RULE_SET_VERSION,
} from '../src/topology/semantic-relation-engine.js'

test('spatial endpoint inference remains a candidate and never leaks into confirmed graph', () => {
  const bundle = topologyBundle({
    nodes: [node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
  })
  const sourceBefore = structuredClone(bundle.geometries)
  const result = generateRelationArtifacts(bundle, {
    generatedAt: '2026-07-29T00:00:00.000Z',
  })

  assert.ok(result.candidates.some(({ candidateType }) => candidateType === 'endpoint_device'))
  assert.ok(result.candidates.every(({ candidateStatus }) => (
    ['candidate', 'ambiguous'].includes(candidateStatus)
  )))
  assert.equal(result.confirmedRelations.length, 0)
  assert.equal(result.graph.edges.length, 0)
  assert.deepEqual(bundle.geometries, sourceBefore)
  assert.equal(result.readiness.topologyReadiness, 'not_ready')
  assert.ok(result.readiness.blockingReasons.includes('held_out_accuracy_not_proven'))
  assert.deepEqual(result.summary, {
    candidateCount: 1,
    confirmedEdgeCount: 0,
    confirmedDeviceEdgeCount: 0,
    confirmedRelationCount: 0,
    confirmedPathAttachmentCount: 0,
    confirmedPathContinuationCount: 0,
    ambiguousCount: 0,
    rejectedCount: 0,
    revokedCount: 0,
    unresolvedCount: 1,
    componentCount: 1,
    isolatedNodeCount: 1,
    falseComponentMergeCount: 0,
  })
})

test('spatial auto-confirm requires both explicit policy approval and accuracy gates', () => {
  const bundle = topologyBundle({
    nodes: [node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
  })
  const missingAccuracy = generateRelationArtifacts(bundle, {
    config: {
      autoConfirmSpatialInference: true,
    },
  })
  assert.equal(missingAccuracy.confirmedRelations.length, 0)

  const approved = generateRelationArtifacts(bundle, {
    config: {
      autoConfirmSpatialInference: true,
      heldOutPrecision: 0.99,
      pathAccuracy: 0.95,
    },
  })
  assert.equal(approved.confirmedRelations.length, 1)
  assert.equal(approved.confirmedRelations[0].verificationStatus, 'confirmed')
  assert.equal(approved.readiness.topologyReadiness, 'ready')
})

test('redundant confirmed attachments to the same path endpoint are materialized once', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.00001, -7],
    ])],
  }), {
    config: {
      autoConfirmSpatialInference: true,
      heldOutPrecision: 0.99,
      pathAccuracy: 0.95,
    },
  })

  assert.equal(result.confirmedRelations.length, 1)
  assert.equal(result.confirmedRelations[0].relationKind, 'path_attachment')
  assert.equal(result.validation.summary.errors, 0)
})

test('crossing lines do not connect without classified junction evidence', () => {
  const result = generateRelationArtifacts(topologyBundle({
    paths: [
      pathObject('CBL-A', 'fiber_optic', 'Fiber Optic', [
        [110, -7.001],
        [110, -6.999],
      ]),
      pathObject('CBL-B', 'fiber_optic', 'Fiber Optic', [
        [109.999, -7],
        [110.001, -7],
      ]),
    ],
  }))

  assert.equal(
    result.candidates.some(({ candidateType }) => candidateType === 'intersection_with_junction'),
    false,
  )
  assert.equal(result.graph.edges.length, 0)
})

test('classified junction enables a reviewable intersection candidate', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [node('OTB-01', 'infrastructure', 'OTB Junction', [110, -7])],
    paths: [
      pathObject('FO-A', 'fiber_optic', 'Fiber Optic', [
        [110, -7.001],
        [110, -6.999],
      ]),
      pathObject('FO-B', 'fiber_optic', 'Fiber Optic', [
        [109.999, -7],
        [110.001, -7],
      ]),
    ],
  }))

  const intersection = result.candidates.find(({ candidateType }) => (
    candidateType === 'intersection_with_junction'
  ))
  assert.ok(intersection)
  assert.equal(intersection.targetAssetId, 'OTB-01')
  assert.equal(intersection.candidateStatus, 'candidate')
  assert.deepEqual(intersection.sourceGeometryIds.sort(), ['geometry:FO-A', 'geometry:FO-B'])
})

test('multiple junction evidences for one path endpoint materialize as one relation', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [node('OTB-01', 'infrastructure', 'OTB Junction', [110, -7])],
    paths: [
      pathObject('FO-A', 'fiber_optic', 'Fiber Optic', [
        [110, -7.001],
        [110, -6.999],
      ]),
      pathObject('FO-B', 'fiber_optic', 'Fiber Optic', [
        [109.999, -7],
        [110.001, -7],
      ]),
      pathObject('FO-C', 'fiber_optic', 'Fiber Optic', [
        [109.999, -7.001],
        [110.001, -6.999],
      ]),
    ],
  }), {
    config: {
      autoConfirmSpatialInference: true,
      heldOutPrecision: 0.99,
      pathAccuracy: 0.95,
    },
  })

  const junctionRelations = result.confirmedRelations.filter(({ relationType }) => (
    relationType === 'path-junction'
  ))
  assert.equal(junctionRelations.length, 3)
  assert.equal(result.validation.summary.errors, 0)
})

test('tiang can be reviewed as an inline anchor on every nearby compatible path', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [node('T-021', 'infrastructure', 'Tiang', [110.00005, -7])],
    paths: [
      pathObject('FO-A', 'fiber_optic', 'Fiber Optic', [
        [110, -7],
        [110.00005, -7],
        [110.001, -7],
      ]),
      pathObject('FO-B', 'fiber_optic', 'Fiber Optic', [
        [110.00005, -7.001],
        [110.00005, -7],
        [110.00005, -6.999],
      ]),
    ],
  }))

  const inlineCandidates = result.candidates.filter(({ candidateType }) => (
    candidateType === 'inline_device'
  ))
  assert.equal(inlineCandidates.length, 2)
  assert.ok(inlineCandidates.every(({ candidateStatus, proposalStatus }) => (
    candidateStatus === 'candidate' && proposalStatus === 'recommended'
  )))
})

test('nearly equal endpoint-device scores become ambiguous', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [
      node('CAM-A', 'cctv', 'CCTV Camera', [110.00001, -7]),
      node('CAM-B', 'cctv', 'CCTV Camera', [109.99999, -7]),
    ],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
  }))
  const startCandidates = result.candidates.filter(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))

  assert.equal(startCandidates.length, 2)
  assert.ok(startCandidates.every(({ candidateStatus }) => candidateStatus === 'ambiguous'))
  assert.ok(startCandidates.every(({ proposalStatus }) => proposalStatus === 'ambiguous'))
})

test('endpoint gap candidate requires same family, continuation angle, and no nearby device', () => {
  const result = generateRelationArtifacts(topologyBundle({
    paths: [
      pathObject('FO-A', 'fiber_optic', 'Fiber Optic', [
        [110, -7],
        [110.001, -7],
      ]),
      pathObject('FO-B', 'fiber_optic', 'Fiber Optic', [
        [110.00102, -7],
        [110.002, -7],
      ]),
    ],
  }))

  assert.ok(result.candidates.some(({ candidateType, distanceMeters }) => (
    candidateType === 'endpoint_endpoint' && distanceMeters < 3
  )))
})

test('valid explicit metadata is confirmed but dangling metadata blocks readiness', () => {
  const validBundle = topologyBundle({
    nodes: [
      node('SW-A', 'infrastructure', 'Switch', [110, -7]),
      node('SW-B', 'infrastructure', 'Switch', [110.001, -7]),
    ],
    explicitRelations: [{
      explicitRelationEvidenceId: 'explicit-1',
      datasetVersionId: 'dv-topology',
      sourceFeatureId: 'feature:SW-A',
      targetReference: 'SW-B',
      relationType: 'uplink-to',
      direction: 'source_to_target',
    }],
  })
  const valid = generateRelationArtifacts(validBundle)
  assert.equal(valid.confirmedRelations.length, 1)
  assert.equal(valid.confirmedRelations[0].provenance, 'explicit_kml_metadata')
  assert.equal(valid.confirmedRelations[0].verificationStatus, 'confirmed')
  assert.equal(valid.confirmedRelations[0].relationKind, 'device_edge')
  assert.equal(valid.summary.confirmedDeviceEdgeCount, 1)
  assert.equal(valid.graph.edges.length, 1)

  const danglingBundle = structuredClone(validBundle)
  danglingBundle.explicitRelations[0].targetReference = 'MISSING'
  const dangling = generateRelationArtifacts(danglingBundle)
  assert.ok(dangling.eligibilityIssues.some(({ issueCode }) => (
    issueCode === 'explicit_relation_dangling'
  )))
  assert.equal(dangling.confirmedRelations.length, 0)
})

test('line endpoint labels create one bulk-reviewable device connection', () => {
  const left = node('JB-A', 'cctv', 'Junction Box', [110, -7])
  const right = node('CAM-B', 'cctv', 'CCTV Camera', [110.001, -7])
  const cable = pathObject('CBL-LABEL', 'cctv', 'CCTV Cable', [
    [110, -7],
    [110.001, -7],
  ])
  left.object.sourceName = 'JB-A'
  left.object.sourceFolderPath = '/site/CCTV'
  right.object.sourceName = 'Cam-B'
  right.object.sourceFolderPath = '/site/CCTV'
  cable.object.sourceName = 'Jalur JB-A - C-B'
  cable.object.sourceFolderPath = '/site/Cable'

  const bundle = topologyBundle({
    nodes: [left, right],
    paths: [cable],
  })
  const pending = generateRelationArtifacts(bundle)
  const labelCandidate = pending.candidates.find(({ candidateType }) => (
    candidateType === 'line_label_connection'
  ))
  assert.ok(labelCandidate)
  assert.equal(labelCandidate.candidateStatus, 'candidate')
  assert.equal(labelCandidate.proposalStatus, 'recommended')
  assert.equal(labelCandidate.relationKind, 'device_edge')

  const confirmedCandidates = pending.candidates.map((candidate) => (
    candidate.candidateId === labelCandidate.candidateId
      ? {
        ...candidate,
        candidateStatus: 'confirmed',
        proposalStatus: 'confirmed_by_admin_bulk',
      }
      : candidate
  ))
  const confirmed = generateRelationArtifacts(bundle, {
    previousCandidates: confirmedCandidates,
  })
  assert.equal(confirmed.graph.edges.length, 1)
  assert.equal(confirmed.confirmedRelations[0].provenance, 'line_label_inference')
  assert.equal(confirmed.validation.summary.errors, 0)
  assert.ok(confirmed.graph.edges[0].sourceGeometryIds.includes('geometry:CBL-LABEL'))
})

test('line labels resolve decorated JB names and shorthand endpoint identifiers', () => {
  const first = node('JB-001-exp', 'cctv', 'cctv', [110, -7])
  const second = node('JB-002-exp', 'cctv', 'cctv', [110.001, -7])
  const shorthandFirst = node('JB-004', 'cctv', 'cctv', [110.01, -7])
  const shorthandSecond = node('JB-005', 'cctv', 'cctv', [110.011, -7])
  ;[first, second, shorthandFirst, shorthandSecond].forEach(({ object }) => {
    object.sourceFolderPath = '/site/JUNCTION BOX/JB Rekomendasi'
  })
  first.object.sourceName = 'JB-001-exp'
  second.object.sourceName = 'JB-002-exp'
  shorthandFirst.object.sourceName = 'JB-004'
  shorthandSecond.object.sourceName = 'JB-005'

  const decoratedPath = pathObject('FO-DECORATED', 'fiber_optic', 'Fiber Optic', [
    [110, -7],
    [110.001, -7],
  ])
  decoratedPath.object.sourceName = 'FO-JB-001_JB-002-'
  decoratedPath.object.sourceFolderPath = '/site/KABEL/FIBER OPTIC/FO Rekomendasi'
  const shorthandPath = pathObject('FO-SHORTHAND', 'fiber_optic', 'Fiber Optic', [
    [110.01, -7],
    [110.011, -7],
  ])
  shorthandPath.object.sourceName = 'FO-JB-004_005'
  shorthandPath.object.sourceFolderPath = '/site/KABEL/FIBER OPTIC/FO Rekomendasi'

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [first, second, shorthandFirst, shorthandSecond],
    paths: [decoratedPath, shorthandPath],
  }))

  assert.equal(result.unresolved.length, 0)
  assert.ok(result.candidates.some(({ candidateType, targetAssetId }) => (
    candidateType === 'line_label_connection' && targetAssetId === 'JB-002-exp'
  )))
  assert.ok(result.candidates.some(({ candidateType, targetAssetId }) => (
    candidateType === 'line_label_connection' && targetAssetId === 'JB-005'
  )))
  assert.equal(
    result.candidates.filter(({ candidateType }) => candidateType === 'line_label_attachment').length,
    4,
  )
})

test('manual explicit device relation is confirmed and can override family compatibility', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [
      node('CAM-A', 'cctv', 'CCTV Camera', [110, -7]),
      node('SW-A', 'infrastructure', 'Switch', [110.001, -7]),
    ],
    explicitRelations: [{
      explicitRelationEvidenceId: 'manual-1',
      datasetVersionId: 'dv-topology',
      sourceReference: 'CAM-A',
      targetReference: 'SW-A',
      relationType: 'connected-to',
      direction: 'undirected',
      source: 'manual_admin',
      sourceKey: 'manual_device_connection',
      manualConfirmation: {
        actorId: 'admin-1',
        reviewedAt: '2026-08-03T00:00:00.000Z',
        reason: 'Diverifikasi dari dokumentasi lapangan.',
        auditEventId: 'audit-1',
      },
    }],
  }), {
    config: { autoConfirmExplicitMetadata: false },
  })

  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].candidateStatus, 'confirmed')
  assert.equal(result.candidates[0].proposalStatus, 'confirmed_by_admin')
  assert.equal(result.confirmedRelations.length, 1)
  assert.equal(result.confirmedRelations[0].provenance, 'manual_admin')
  assert.equal(result.confirmedRelations[0].verifiedBy, 'admin-1')
  assert.equal(result.confirmedRelations[0].auditEventId, 'audit-1')
  assert.equal(result.graph.edges.length, 1)
  assert.equal(result.validation.summary.errors, 0)
})

test('mixed dataset versions and invalid geometry references reject the whole bundle', () => {
  const bundle = topologyBundle({
    nodes: [node('SW-A', 'infrastructure', 'Switch', [110, -7])],
  })
  bundle.geometries[0].datasetVersionId = 'other-version'
  assert.throws(
    () => generateRelationArtifacts(bundle),
    (error) => error.code === 'invalid_topology_input_bundle',
  )

  const missing = topologyBundle({
    nodes: [node('SW-A', 'infrastructure', 'Switch', [110, -7])],
  })
  missing.classifiedNodes[0].geometryIds = ['not-found']
  assert.throws(
    () => generateRelationArtifacts(missing),
    (error) => error.code === 'invalid_topology_input_bundle',
  )
})

test('duplicate and zero-length linework are diagnosed without modifying source', () => {
  const first = pathObject('FO-A', 'fiber_optic', 'Fiber Optic', [
    [110, -7],
    [110.001, -7],
  ])
  const duplicate = pathObject('FO-B', 'fiber_optic', 'Fiber Optic', [
    [110.001, -7],
    [110, -7],
  ])
  const bundle = topologyBundle({ paths: [first, duplicate] })
  const result = generateRelationArtifacts(bundle)
  assert.ok(result.lineworkIssues.some(({ issueCode }) => issueCode === 'duplicate_linework'))
  assert.equal(result.graph.edges.length, 0)
})

test('partially overlapping linework is detected through spatially filtered path pairs', () => {
  const left = pathObject('FO-A', 'fiber_optic', 'Fiber Optic', [
    [110, -7],
    [110.002, -7],
  ])
  const right = pathObject('FO-B', 'fiber_optic', 'Fiber Optic', [
    [110.001, -7],
    [110.003, -7],
  ])
  const result = generateRelationArtifacts(topologyBundle({ paths: [left, right] }))
  assert.ok(result.lineworkIssues.some(({ issueCode }) => issueCode === 'overlapping_linework'))
})

function topologyBundle({
  nodes = [],
  paths = [],
  explicitRelations = [],
} = {}) {
  const classifiedNodes = nodes.map(({ object }) => object)
  const classifiedPaths = paths.map(({ object }) => object)
  const geometries = [...nodes, ...paths].map(({ geometry }) => geometry)
  return {
    datasetVersion: {
      id: 'dv-topology',
      sourceChecksum: `sha256:${'a'.repeat(64)}`,
    },
    site: 'site-1',
    classifiedNodes,
    classifiedPaths,
    geometries,
    explicitRelations,
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
      siteId: 'site-1',
      objectRole: 'device_node',
      networkFamily,
      assetType,
      category: assetType,
      classificationStatus: 'classified',
      classificationEvidence: evidence(assetType),
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-topology',
      sourceFeatureId,
      geometryType: 'Point',
      coordinates,
      valid: true,
      geometryFingerprint: `fingerprint:${assetId}`,
    },
  }
}

function pathObject(assetId, networkFamily, assetType, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-1',
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
      datasetVersionId: 'dv-topology',
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
    observedValue: `/Network/${value}`,
    normalizedValue: value,
    ruleId: 'fixture',
    weight: 0.8,
    explanation: 'Fixture evidence.',
  }]
}
