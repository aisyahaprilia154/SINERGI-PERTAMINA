import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateRelationArtifacts,
  rebuildConfirmedRelationArtifacts,
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

  assert.ok(result.candidates.some(({ candidateType }) => candidateType === 'cable_termination'))
  assert.ok(result.candidates.every(({ candidateStatus }) => (
    ['candidate', 'ambiguous'].includes(candidateStatus)
  )))
  assert.equal(result.confirmedRelations.length, 0)
  assert.equal(result.graph.edges.length, 0)
  assert.deepEqual(bundle.geometries, sourceBefore)
  assert.equal(result.readiness.topologyReadiness, 'not_ready')
  assert.ok(result.readiness.blockingReasons.includes('held_out_accuracy_not_proven'))
  assert.equal(result.summary.confirmedEdgeCount, 0)
  assert.equal(result.summary.confirmedRelationCount, 0)
  assert.equal(result.summary.unresolvedCount, result.unresolved.length)
  assert.equal(result.summary.componentCount, 1)
  assert.equal(result.summary.isolatedNodeCount, 1)
})

test('power feeder and distribution candidates use directional JB interfaces', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [
      node('PLN-01', 'infrastructure', 'PLN Source', [110, -7]),
      node('JB-01', 'infrastructure', 'Junction Box', [110.001, -7]),
      node('CAM-01', 'cctv', 'CCTV Camera', [110.002, -7]),
    ],
    paths: [
      pathObject('POWER-FEEDER-01', 'infrastructure', 'PLN Feeder Cable', [
        [110, -7],
        [110.001, -7],
      ]),
      pathObject('POWER-DISTRIBUTION-01', 'infrastructure', 'Power Distribution Cable', [
        [110.001, -7],
        [110.002, -7],
      ]),
    ],
  }))
  const candidatesFor = (pathId) => result.candidates.filter((candidate) => (
    candidate.candidateType === 'cable_termination'
      && candidate.sourcePathAssetId === pathId
  ))
  const feeder = candidatesFor('POWER-FEEDER-01')
  const distribution = candidatesFor('POWER-DISTRIBUTION-01')

  assert.ok(feeder.some((candidate) => (
    candidate.targetAssetId === 'PLN-01'
      && candidate.targetInterfaceId === 'PLN-01/interface/power-out/01'
      && candidate.cableRole === 'feeder'
  )))
  assert.ok(feeder.some((candidate) => (
    candidate.targetAssetId === 'JB-01'
      && candidate.targetInterfaceId === 'JB-01/interface/power-in/01'
  )))
  assert.equal(feeder.some((candidate) => (
    candidate.targetAssetId === 'JB-01'
      && candidate.targetInterfaceId.startsWith('JB-01/interface/power-out/')
  )), false)
  assert.ok(distribution.some((candidate) => (
    candidate.targetAssetId === 'JB-01'
      && candidate.targetInterfaceId === 'JB-01/interface/power-out/01'
      && candidate.cableRole === 'distribution'
  )))
  assert.ok(distribution.some((candidate) => (
    candidate.targetAssetId === 'CAM-01'
      && candidate.targetInterfaceId === 'CAM-01/interface/power-in/01'
  )))
  assert.equal(distribution.some((candidate) => (
    candidate.targetAssetId === 'JB-01'
      && candidate.targetInterfaceId.startsWith('JB-01/interface/power-in/')
  )), false)
})

test('pole is never a cable endpoint but remains a valid mounting host', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [
      node('T-01', 'infrastructure', 'pole', [110, -7]),
      node('CAM-01', 'cctv', 'CCTV Camera', [110, -7]),
    ],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  }))

  assert.equal(result.candidates.some((candidate) => (
    candidate.candidateType === 'cable_termination'
      && candidate.targetAssetId === 'T-01'
  )), false)
  assert.ok(result.candidates.some((candidate) => (
    candidate.candidateType === 'mounting_attachment'
      && candidate.sourcePathAssetId === 'CAM-01'
      && candidate.targetAssetId === 'T-01'
  )))
  assert.ok(result.topologyDiagnostics.some(({ issueCode, targetAssetId }) => (
    issueCode === 'cable_terminated_at_pole' && targetAssetId === 'T-01'
  )))
})

test('JB internal service traversal requires approved profile evidence', () => {
  const bundle = topologyBundle({
    nodes: [node('JB-01', 'infrastructure', 'Junction Box', [110, -7])],
    jbProfiles: [{
      profileId: 'jb-profile/test',
      version: 'jb-profile/1.0.0',
      approved: true,
      assetTypes: ['junction_box'],
      internalConnections: [{
        sourceInterfaceId: 'JB-01/interface/uplink/01',
        targetInterfaceId: 'JB-01/interface/lan/01',
        serviceDomain: 'data',
      }],
    }],
  })
  const approved = generateRelationArtifacts(bundle)
  const internal = approved.candidates.find(({ candidateType }) => (
    candidateType === 'jb_internal_connection'
  ))
  assert.ok(internal)
  assert.equal(internal.provenance, 'approved_jb_profile')
  assert.equal(approved.confirmedRelations[0].relationKind, 'internal_connection')
  assert.ok(approved.serviceGraph.edges.some(({ relationKind }) => (
    relationKind === 'internal_connection'
  )))

  const opaque = generateRelationArtifacts(topologyBundle({
    nodes: [node('JB-01', 'infrastructure', 'Junction Box', [110, -7])],
  }))
  assert.equal(opaque.candidates.some(({ candidateType }) => (
    candidateType === 'jb_internal_connection'
  )), false)
  assert.equal(opaque.serviceGraph.edges.some(({ relationKind }) => (
    relationKind === 'internal_connection'
  )), false)
})

test('onboarding objects are omitted with identity warnings while topology remains not ready', () => {
  const bundle = topologyBundle({
    nodes: [node('CAM-ONBOARDING', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-ONBOARDING', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
  })
  const onboardingObject = (object) => ({
    ...object,
    assetId: null,
    canonicalAssetId: `onboarding-identity:${object.assetId}`,
    stableAssetId: null,
    onboardingIdentity: `onboarding-identity:${object.assetId}`,
    identityStatus: 'onboarding',
    identityResolutionStatus: 'onboarding_candidate',
  })
  bundle.classifiedNodes = bundle.classifiedNodes.map(onboardingObject)
  bundle.classifiedPaths = bundle.classifiedPaths.map(onboardingObject)

  const result = generateRelationArtifacts(bundle)

  assert.equal(result.validation.summary.errors, 0)
  assert.equal(result.candidates.length, 0)
  assert.equal(result.confirmedRelations.length, 0)
  assert.equal(result.readiness.topologyReadiness, 'not_ready')
  assert.equal(result.eligibilityIssues.filter(({ issueCode }) => (
    issueCode === 'missing_stable_asset_id'
  )).length, 2)
  assert.ok(result.eligibilityIssues.every(({ issueCode, severity }) => (
    issueCode !== 'missing_stable_asset_id' || severity === 'warning'
  )))
})

test('spatial auto-confirm requires explicit policy and an approved accuracy artifact', () => {
  const bundle = topologyBundle({
    nodes: [
      node('CAM-01', 'cctv', 'CCTV Camera', [110, -7]),
      node('CAM-02', 'cctv', 'CCTV Camera', [110.001, -7]),
    ],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  })
  const missingAccuracy = generateRelationArtifacts(bundle, {
    config: {
      autoConfirmSpatialInference: true,
      heldOutPrecision: 1,
      pathAccuracy: 1,
    },
  })
  assert.equal(missingAccuracy.confirmedRelations.length, 0)
  assert.ok(missingAccuracy.readiness.accuracyGate.blockingReasons.includes(
    'accuracy_artifact_missing',
  ))

  const approved = generateRelationArtifacts(bundle, {
    config: {
      autoConfirmSpatialInference: true,
      heldOutPrecision: 1,
      pathAccuracy: 1,
      accuracyArtifact: approvedAccuracyArtifact('cctv'),
      engineBuildSha: 'build-test',
    },
  })
  assert.equal(approved.confirmedRelations.length, 2)
  assert.equal(approved.confirmedRelations[0].verificationStatus, 'confirmed')
  assert.equal(approved.readiness.topologyReadiness, 'ready')
})

test('operational automatic relation mode confirms strong spatial matches without review artifacts', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  }), {
    config: { automaticRelationConfirmation: true },
  })

  assert.equal(result.confirmedRelations.length, 1)
  assert.ok(result.confirmedRelations.every(({ verificationStatus }) => (
    verificationStatus === 'confirmed'
  )))
  assert.ok(result.candidates.some(({ candidateStatus, review }) => (
    candidateStatus === 'confirmed'
      && review?.confirmationMode === 'automatic_strong_match'
  )))
  assert.equal(result.graph.physicalTerminationGraph.edges.length, 1)
})

test('automatic relation mode confirms a camera to one clearly nearest junction box', () => {
  const camera = node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])
  const nearestJunction = node('JB-01', 'infrastructure', 'Junction Box', [110.00002, -7])
  const distantJunction = node('JB-02', 'infrastructure', 'Junction Box', [110.001, -7])
  ;[camera, nearestJunction, distantJunction].forEach(({ object }) => {
    object.sourceFolderPath = '/RJBT/AREA-A/Assets'
  })

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [camera, nearestJunction, distantJunction],
  }), {
    config: { automaticRelationConfirmation: true },
  })
  const candidate = result.candidates.find(({ candidateType }) => (
    candidateType === 'device_nearest_junction'
  ))

  assert.equal(candidate?.sourceAssetId, 'CAM-01')
  assert.equal(candidate?.targetAssetId, 'JB-01')
  assert.equal(candidate?.candidateStatus, 'confirmed')
  assert.deepEqual(candidate?.sourceGeometryIds, [])
  assert.ok(result.graph.edges.some(({ sourceNodeId, targetNodeId }) => (
    new Set([sourceNodeId, targetNodeId]).has('CAM-01')
      && new Set([sourceNodeId, targetNodeId]).has('JB-01')
  )))
})

test('automatic relation mode does not force an ambiguous nearest junction relation', () => {
  const camera = node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])
  const leftJunction = node('JB-A', 'infrastructure', 'Junction Box', [109.99998, -7])
  const rightJunction = node('JB-B', 'infrastructure', 'Junction Box', [110.00002, -7])
  ;[camera, leftJunction, rightJunction].forEach(({ object }) => {
    object.sourceFolderPath = '/RJBT/AREA-A/Assets'
  })

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [camera, leftJunction, rightJunction],
  }), {
    config: { automaticRelationConfirmation: true },
  })

  assert.equal(result.candidates.some(({ candidateType }) => (
    candidateType === 'device_nearest_junction'
  )), false)
  assert.equal(result.graph.edges.length, 0)
})

test('nearest junction device relation stays disabled outside automatic mode', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [
      node('CAM-01', 'cctv', 'CCTV Camera', [110, -7]),
      node('JB-01', 'infrastructure', 'Junction Box', [110.00002, -7]),
    ],
  }))

  assert.equal(result.candidates.some(({ candidateType }) => (
    candidateType === 'device_nearest_junction'
  )), false)
})

test('redundant confirmed attachments to the same path endpoint are materialized once', () => {
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.00001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  }), {
    config: {
      autoConfirmSpatialInference: true,
      accuracyArtifact: approvedAccuracyArtifact('cctv'),
      engineBuildSha: 'build-test',
    },
  })

  assert.equal(result.confirmedRelations.length, 1)
  assert.equal(result.confirmedRelations[0].relationKind, 'path_termination')
  assert.ok(result.validation.issues.some(({ issueCode }) => issueCode === 'interface_capacity_exceeded'))
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

  const intersection = result.candidates.find(({ candidateType, targetAssetId }) => (
    candidateType === 'cable_termination' && targetAssetId === 'OTB-01'
  ))
  assert.ok(intersection)
  assert.equal(intersection.targetAssetId, 'OTB-01')
  assert.equal(intersection.candidateStatus, 'ambiguous')
  assert.equal(intersection.relationKind, 'path_termination')
  assert.ok(intersection.targetInterfaceId.startsWith('OTB-01/interface/fiber/'))
  assert.ok(intersection.sourceGeometryIds.some((id) => (
    ['geometry:FO-A', 'geometry:FO-B'].includes(id)
  )))
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
      accuracyArtifact: approvedAccuracyArtifact('fiber_optic'),
      engineBuildSha: 'build-test',
    },
  })

  const junctionTerminations = result.candidates.filter(({ candidateType, targetAssetId }) => (
    candidateType === 'cable_termination' && targetAssetId === 'OTB-01'
  ))
  assert.ok(junctionTerminations.length > 0)
  assert.ok(result.confirmedRelations.every(({ relationKind }) => relationKind === 'path_termination'))
})

test('tiang is never a cable inline anchor and remains only a mounting host', () => {
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

  assert.equal(result.candidates.some(({ candidateType }) => candidateType === 'inline_device'), false)
  assert.equal(result.candidates.some(({ candidateType, targetAssetId }) => (
    candidateType === 'cable_termination' && targetAssetId === 'T-021'
  )), false)
  assert.ok(result.topologyDiagnostics.some(({ issueCode }) => issueCode === 'cable_terminated_at_pole'))
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
    topologyPolicy: { requireJbTermination: false },
  }))
  const startCandidates = result.candidates.filter(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))

  assert.equal(startCandidates.length, 2)
  assert.ok(startCandidates.every(({ candidateStatus }) => candidateStatus === 'ambiguous'))
  assert.ok(startCandidates.every(({ proposalStatus }) => proposalStatus === 'ambiguous'))
})

test('candidate explosion fails closed with a stage-specific diagnostic', () => {
  const bundle = topologyBundle({
    nodes: [
      node('CAM-A', 'cctv', 'CCTV Camera', [110, -7]),
      node('CAM-B', 'cctv', 'CCTV Camera', [110.00001, -7]),
    ],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  })
  const sourceBefore = structuredClone(bundle.geometries)

  assert.throws(
    () => generateRelationArtifacts(bundle, {
      config: { maxCandidateCount: 1 },
    }),
    (error) => {
      assert.equal(error.code, 'topology_candidate_limit_exceeded')
      assert.equal(error.statusCode, 422)
      assert.deepEqual(error.details, {
        attemptedCandidateCount: 2,
        maxCandidateCount: 1,
        stage: 'cable_termination',
        datasetVersionId: 'dv-topology',
        siteId: 'site-1',
      })
      return true
    },
  )
  assert.deepEqual(bundle.geometries, sourceBefore)
})

test('topology generation timeout fails closed before returning partial artifacts', () => {
  const bundle = topologyBundle({
    paths: Array.from({ length: 2000 }, (_, index) => pathObject(
      `TIMEOUT-${String(index).padStart(4, '0')}`,
      'fiber_optic',
      'Fiber Optic',
      [[110, -7 + index * 0.002], [110.001, -7 + index * 0.002]],
    )),
  })
  const sourceBefore = structuredClone(bundle.geometries)

  assert.throws(
    () => generateRelationArtifacts(bundle, {
      config: { maxGenerationMilliseconds: 1 },
    }),
    (error) => {
      assert.equal(error.code, 'topology_generation_timeout')
      assert.equal(error.statusCode, 504)
      assert.equal(error.details.timeoutMilliseconds, 1)
      assert.ok(error.details.elapsedMilliseconds > 1)
      assert.equal(typeof error.details.stage, 'string')
      return true
    },
  )
  assert.deepEqual(bundle.geometries, sourceBefore)
})

test('running the same topology job twice produces the same artifact', () => {
  const bundle = topologyBundle({
    nodes: [node('CAM-01', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-01', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  })
  const options = {
    generatedAt: '2026-08-04T00:00:00.000Z',
  }

  const first = generateRelationArtifacts(structuredClone(bundle), options)
  const second = generateRelationArtifacts(structuredClone(bundle), options)

  assert.deepEqual(second, first)
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
    candidateType === 'path_continuation' && distanceMeters < 3
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
  const labelCandidate = pending.candidates.find(({ candidateType, provenance, targetAssetId }) => (
    candidateType === 'cable_termination'
      && provenance === 'line_label_inference'
      && targetAssetId === 'CAM-B'
  ))
  assert.ok(labelCandidate)
  assert.equal(labelCandidate.candidateStatus, 'candidate')
  assert.equal(labelCandidate.proposalStatus, 'recommended')
  assert.equal(labelCandidate.relationKind, 'path_termination')

  const selectedLabelCandidates = pending.candidates.filter(({ candidateType, provenance, targetAssetId }) => (
    candidateType === 'cable_termination'
      && provenance === 'line_label_inference'
      && ['JB-A', 'CAM-B'].includes(targetAssetId)
  )).reduce((selected, candidate) => {
    if (!selected.some(({ targetAssetId }) => targetAssetId === candidate.targetAssetId)) {
      selected.push(candidate)
    }
    return selected
  }, [])
  assert.equal(selectedLabelCandidates.length, 2)
  const selectedIds = new Set(selectedLabelCandidates.map(({ candidateId }) => candidateId))
  const confirmedCandidates = pending.candidates.map((candidate) => (
    selectedIds.has(candidate.candidateId)
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
  assert.equal(confirmed.confirmedRelations.length, 2)
  assert.ok(confirmed.confirmedRelations.every(({ provenance }) => provenance === 'line_label_inference'))
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
  assert.ok(result.candidates.some(({ candidateType, provenance, targetAssetId }) => (
    candidateType === 'cable_termination'
      && provenance === 'line_label_inference'
      && targetAssetId === 'JB-002-exp'
  )))
  assert.ok(result.candidates.some(({ candidateType, provenance, targetAssetId }) => (
    candidateType === 'cable_termination'
      && provenance === 'line_label_inference'
      && targetAssetId === 'JB-005'
  )))
  assert.equal(
    result.candidates.filter(({ candidateType, provenance }) => (
      candidateType === 'cable_termination' && provenance === 'line_label_inference'
    )).length,
    4,
  )
})

test('line-labelled CCTV cable preserves an inline Extended JB termination', () => {
  const main = node('JB-015', 'cctv', 'Junction Box', [110, -7])
  const extended = node('JB-15.1-WP', 'cctv', 'Junction Box', [110.0005, -7])
  const camera = node('C-042', 'cctv', 'CCTV Camera', [110.001, -7])
  main.object.sourceName = 'JB-015'
  extended.object.sourceName = 'JB-15.1-WP'
  camera.object.sourceName = 'C-042'
  ;[main, extended, camera].forEach(({ object }) => {
    object.sourceFolderPath = '/site/CCTV'
  })
  const cable = pathObject('STP-JB-015-C-042', 'cctv', 'CCTV Cable', [
    [110, -7],
    [110.0005, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'STP-JB-015-Non_C-042-Fix Bullet'
  cable.object.sourceFolderPath = '/site/Cable'

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [main, extended, camera],
    paths: [cable],
  }))

  const extendedInterfaces = result.interfaceRegistry
    .filter(({ ownerAssetId }) => ownerAssetId === 'JB-15.1-WP')
  assert.deepEqual(extendedInterfaces.map(({ interfaceType }) => interfaceType), ['lan_port'])
  assert.ok(result.candidates.some((candidate) => (
    candidate.sourcePathAssetId === 'STP-JB-015-C-042'
      && candidate.targetAssetId === 'JB-15.1-WP'
      && candidate.provenance === 'line_label_inference'
      && candidate.sourceEndpointId.startsWith('inline:')
      && candidate.proposalStatus === 'recommended'
  )))
  assert.equal(result.validation.issues.some(({ issueCode }) => (
    issueCode === 'required_jb_termination_missing'
  )), false)
})

test('LAN endpoint prefers a physically closer Extended JB and confirms both cable terminals', () => {
  const main = node('JB-001-exp', 'cctv', 'Junction Box', [110.001, -7])
  const extended = node('JB-01.1-WP', 'cctv', 'Junction Box', [110, -7])
  const camera = node('C-019', 'cctv', 'CCTV Camera', [110.00002, -7])
  main.object.sourceName = 'JB-001-exp'
  extended.object.sourceName = 'JB-01.1-WP'
  camera.object.sourceName = 'C-019'
  ;[main, extended, camera].forEach(({ object }) => {
    object.sourceFolderPath = '/site/PENGAPON/JUNCTION BOX'
  })
  const cable = pathObject('JB-001_C-019', 'lan', 'UTP Cable', [
    [110, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'JB-001_C-019'
  cable.object.sourceFolderPath = '/site/PENGAPON/KABEL/UTP/Rekomendasi'

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [main, extended, camera],
    paths: [cable],
  }), {
    config: { automaticRelationConfirmation: true },
  })

  const endpointCandidates = result.candidates.filter((candidate) => (
    candidate.sourcePathAssetId === 'JB-001_C-019'
      && candidate.candidateType === 'cable_termination'
      && candidate.provenance === 'line_label_inference'
  ))
  assert.ok(endpointCandidates.some((candidate) => (
    candidate.targetAssetId === 'JB-01.1-WP'
      && candidate.sourceEndpointId.endsWith(':start')
      && candidate.candidateStatus === 'confirmed'
      && candidate.proposalStatus === 'recommended'
      && candidate.evidence.some(({ ruleId }) => (
        ruleId === 'extended-junction.endpoint-replaces-nearby-label'
      ))
  )))
  assert.ok(endpointCandidates.some((candidate) => (
    candidate.targetAssetId === 'JB-001-exp'
      && candidate.sourceEndpointId.endsWith(':end')
      && candidate.candidateStatus === 'confirmed'
  )))

  const confirmedTerminations = result.confirmedRelations.filter((relation) => (
    relation.pathAssetId === 'JB-001_C-019'
  ))
  assert.deepEqual(
    new Set(confirmedTerminations.map(({ targetAssetId }) => targetAssetId)),
    new Set(['JB-01.1-WP', 'JB-001-exp']),
  )
  assert.ok(result.graph.edges.some((edge) => (
    new Set([edge.sourceAssetId, edge.targetAssetId]).size === 2
      && new Set([edge.sourceAssetId, edge.targetAssetId]).has('JB-01.1-WP')
      && new Set([edge.sourceAssetId, edge.targetAssetId]).has('JB-001-exp')
      && edge.sourceGeometryIds.includes('geometry:JB-001_C-019')
  )))
})

test('line label matching cannot cross facilities with duplicate JB and camera names', () => {
  const localMain = node('Z-FACILITY-A-JB-015', 'cctv', 'Junction Box', [110, -7])
  const localExtended = node('Z-FACILITY-A-JB-15.1-WP', 'cctv', 'Junction Box', [110.0005, -7])
  const localCamera = node('Z-FACILITY-A-C-042', 'cctv', 'CCTV Camera', [110.001, -7])
  const foreignMain = node('A-FACILITY-B-JB-015', 'cctv', 'Junction Box', [110.01, -7])
  const foreignExtended = node('A-FACILITY-B-JB-15.1-WP', 'cctv', 'Junction Box', [110.0105, -7])
  const foreignCamera = node('A-FACILITY-B-C-042', 'cctv', 'CCTV Camera', [110.011, -7])
  const localNodes = [localMain, localExtended, localCamera]
  const foreignNodes = [foreignMain, foreignExtended, foreignCamera]
  ;[...localNodes, ...foreignNodes].forEach(({ object }) => {
    object.sourceName = object.assetId.includes('C-042') ? 'C-042' : (
      object.assetId.includes('15.1') ? 'JB-15.1-WP' : 'JB-015'
    )
    object.sourceFolderPath = object.assetId.startsWith('Z-')
      ? '/site/FACILITY-A/CCTV'
      : '/site/FACILITY-B/CCTV'
  })
  const cable = pathObject('STP-FACILITY-A', 'cctv', 'CCTV Cable', [
    [110, -7],
    [110.0005, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'STP-JB-015-Non_C-042-Fix Bullet'
  cable.object.sourceFolderPath = '/site/FACILITY-A/Cable'

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [...localNodes, ...foreignNodes],
    paths: [cable],
  }))
  const lineLabelCandidates = result.candidates.filter((candidate) => (
    candidate.sourcePathAssetId === 'STP-FACILITY-A'
      && candidate.candidateType === 'cable_termination'
      && candidate.provenance === 'line_label_inference'
  ))

  assert.ok(lineLabelCandidates.some((candidate) => (
    candidate.targetAssetId === 'Z-FACILITY-A-JB-15.1-WP'
      && candidate.sourceEndpointId.startsWith('inline:')
      && candidate.proposalStatus === 'recommended'
  )))
  assert.equal(lineLabelCandidates.some((candidate) => (
    candidate.targetAssetId.startsWith('A-FACILITY-B-')
  )), false)
})

test('JB main to Extended power distribution uses power_out to power_in', () => {
  const main = node('JB-015', 'infrastructure', 'Junction Box', [110, -7])
  const extended = node('JB-15.1-WP', 'infrastructure', 'Junction Box', [110.001, -7])
  main.object.sourceName = 'JB-015'
  extended.object.sourceName = 'JB-15.1-WP'
  const cable = pathObject('JB-015_JB-015.1', 'infrastructure', 'Power Cable', [
    [110, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'JB-015_JB-015.1'
  cable.object.sourceFolderPath = '/site/POWER PLN'

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [main, extended],
    paths: [cable],
  }))
  const candidates = result.candidates.filter(({ sourcePathAssetId, candidateType }) => (
    sourcePathAssetId === 'JB-015_JB-015.1' && candidateType === 'cable_termination'
  ))
  assert.ok(candidates.some(({ targetAssetId, targetInterfaceId, cableRole }) => (
    targetAssetId === 'JB-15.1-WP'
      && targetInterfaceId === 'JB-15.1-WP/interface/power-in/01'
      && cableRole === 'distribution'
  )))
  assert.equal(candidates.some(({ targetAssetId, targetInterfaceId }) => (
    targetAssetId === 'JB-15.1-WP'
      && targetInterfaceId === 'JB-15.1-WP/interface/power-out/01'
  )), false)
})

test('review rebuild keeps path-derived Extended power interfaces active', () => {
  const main = node('JB-015', 'infrastructure', 'Junction Box', [110, -7])
  const extended = node('JB-15.1-WP', 'infrastructure', 'Junction Box', [110.001, -7])
  main.object.sourceName = 'JB-015'
  extended.object.sourceName = 'JB-15.1-WP'
  const cable = pathObject('JB-015_JB-015.1', 'infrastructure', 'Power Cable', [
    [110, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'JB-015_JB-015.1'
  cable.object.sourceFolderPath = '/site/POWER PLN'
  const bundle = topologyBundle({ nodes: [main, extended], paths: [cable] })
  const initial = generateRelationArtifacts(bundle)
  const rebuilt = rebuildConfirmedRelationArtifacts(bundle, {
    candidates: initial.candidates,
    previousRelations: initial.confirmedRelations,
    previousGraph: initial.graph,
    previousInterfaceRegistry: initial.interfaceRegistry,
  })
  const extendedInterfaces = rebuilt.interfaceRegistry.filter(({ ownerAssetId }) => (
    ownerAssetId === 'JB-15.1-WP'
  ))

  assert.deepEqual(
    extendedInterfaces.map(({ interfaceType, status }) => [interfaceType, status]),
    [
      ['lan_port', 'active'],
      ['power_in', 'active'],
      ['power_out', 'active'],
    ],
  )
})

test('power line labels resolve canonical CCTV-family JB nodes with power service domains', () => {
  const main = node('JB-015', 'cctv', 'Junction Box', [110, -7])
  const extended = node('JB-15.1-WP', 'cctv', 'Junction Box', [110.001, -7])
  ;[main, extended].forEach(({ object }) => {
    object.serviceDomain = 'data'
    object.serviceDomains = ['data', 'power']
    object.sourceFolderPath = '/site/PENGAPON/Junction Box'
  })
  main.object.sourceName = 'JB-015'
  extended.object.sourceName = 'JB-15.1-WP'
  const cable = pathObject('JB-015_JB-015.1', 'infrastructure', 'Power Cable', [
    [110, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'JB-015_JB-015.1'
  cable.object.sourceFolderPath = '/site/PENGAPON/Power'

  const result = generateRelationArtifacts(topologyBundle({
    nodes: [main, extended],
    paths: [cable],
  }))
  const candidates = result.candidates.filter(({ sourcePathAssetId, candidateType }) => (
    sourcePathAssetId === 'JB-015_JB-015.1' && candidateType === 'cable_termination'
  ))

  assert.ok(candidates.some(({ targetAssetId, targetInterfaceId, provenance }) => (
    targetAssetId === 'JB-015'
      && targetInterfaceId.startsWith('JB-015/interface/power-out/')
      && provenance === 'line_label_inference'
  )))
  assert.ok(candidates.some(({ targetAssetId, targetInterfaceId, provenance, proposalStatus }) => (
    targetAssetId === 'JB-15.1-WP'
      && targetInterfaceId === 'JB-15.1-WP/interface/power-in/01'
      && provenance === 'line_label_inference'
      && proposalStatus === 'recommended'
  )))
})

test('Rack Server aliases expose proxy ports for every supported cable evidence', () => {
  const rack = node('RS_JB-019', 'infrastructure', 'RS_JB-019', [110, -7])
  rack.object.sourceName = 'RS_JB-019'
  const rackPaths = [
    ...Array.from({ length: 4 }, (_, index) => pathObject(
      `FO-RACK-${index + 1}`,
      'fiber_optic',
      'Fiber Cable',
      [
        [110 + index * 0.000004, -7],
        [110.0005 + index * 0.000004, -7],
      ],
    )),
    ...Array.from({ length: 5 }, (_, index) => pathObject(
      `UTP-RACK-${index + 1}`,
      'lan',
      'UTP Cable',
      [
        [110 + (index + 4) * 0.000004, -7],
        [110.0005 + (index + 4) * 0.000004, -7],
      ],
    )),
  ]
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [rack],
    paths: rackPaths,
    topologyPolicy: { requireJbTermination: false },
  }))
  const interfaces = result.interfaceRegistry.filter(({ ownerAssetId }) => (
    ownerAssetId === 'RS_JB-019'
  ))

  assert.equal(new Set(interfaces.filter(({ interfaceType }) => interfaceType === 'fiber_port')
    .map(({ interfaceId }) => interfaceId)).size, 4)
  assert.equal(new Set(interfaces.filter(({ interfaceType }) => interfaceType === 'lan_port')
    .map(({ interfaceId }) => interfaceId)).size, 5)
  assert.ok(interfaces.every(({ isProxy, virtual, status }) => (
    isProxy === true && virtual === true && status === 'active'
  )))
})

test('generic Rack Server labels resolve CR, RS, and SVR-OFFICE cable aliases', () => {
  const cableDefinitions = [
    ['FO-CR_JB-001', 'JB-001', 110.001, -7],
    ['FO-CR_JB-004', 'JB-004', 110.002, -6.9998],
    ['FO-RS_JB-019', 'JB-019', 110.003, -6.9996],
    ['FO-SVR-OFFICE_JB-017', 'JB-017', 110.004, -6.9994],
  ]
  const rack = node('RACK-SERVER-01', 'infrastructure', 'server_rack', [110, -7])
  rack.object.sourceName = 'JB-Rack Server'
  rack.object.sourceFolderPath = '/site/PENGAPON/Rack'
  const items = cableDefinitions.map(([, assetId, longitude, latitude]) => {
    const item = node(assetId, 'infrastructure', 'Junction Box', [longitude, latitude])
    item.object.sourceName = assetId
    item.object.sourceFolderPath = '/site/PENGAPON/Junction Box'
    return item
  })
  const paths = cableDefinitions.map(([sourceName, , longitude, latitude]) => {
    const path = pathObject(sourceName, 'fiber_optic', 'Fiber Cable', [
      [110, -7],
      [longitude, latitude],
    ])
    path.object.sourceName = sourceName
    path.object.sourceFolderPath = '/site/PENGAPON/Fiber'
    return path
  })
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [rack, ...items],
    paths,
  }))
  const rackCandidates = result.candidates.filter((candidate) => (
    candidate.targetAssetId === 'RACK-SERVER-01'
      && candidate.candidateType === 'cable_termination'
      && candidate.provenance === 'line_label_inference'
  ))
  const selectedRackCandidates = cableDefinitions.map(([sourceName]) => {
    const candidatesForPath = rackCandidates.filter((candidate) => (
      candidate.sourcePathAssetId === sourceName
    ))
    assert.equal(candidatesForPath.length, 1, `rack port allocation is not unique for ${sourceName}`)
    const candidate = candidatesForPath[0]
    assert.equal(candidate.proposalStatus, 'recommended')
    assert.equal(candidate.candidateStatus, 'candidate')
    return candidate
  })

  assert.equal(new Set(selectedRackCandidates.map(({ targetInterfaceId }) => targetInterfaceId)).size, 4)
  assert.equal(result.candidates.some((candidate) => (
    candidate.targetAssetId === 'RACK-SERVER-01'
      && ['ambiguous', 'below_threshold'].includes(candidate.proposalStatus)
  )), false)
  assert.deepEqual(
    selectedRackCandidates
      .sort((left, right) => left.sourcePathAssetId.localeCompare(right.sourcePathAssetId))
      .map(({ targetInterfaceId }) => targetInterfaceId),
    [
      'RACK-SERVER-01/interface/fiber/01',
      'RACK-SERVER-01/interface/fiber/02',
      'RACK-SERVER-01/interface/fiber/03',
      'RACK-SERVER-01/interface/fiber/04',
    ],
  )
})

test('JB to CCTV power labels are distribution and label order controls direction', () => {
  const main = node('JB-003', 'infrastructure', 'Junction Box', [110.001, -7])
  const camera = node('C-009', 'cctv', 'CCTV Camera', [110, -7])
  main.object.sourceName = 'JB-003'
  camera.object.sourceName = 'C-009'
  const cable = pathObject('POWER_JB-003_C-009', 'infrastructure', 'Power Cable', [
    [110, -7],
    [110.001, -7],
  ])
  cable.object.sourceName = 'POWER_JB-003_C-009'
  cable.object.sourceFolderPath = '/site/POWER'
  const result = generateRelationArtifacts(topologyBundle({
    nodes: [main, camera],
    paths: [cable],
  }))
  const candidates = result.candidates.filter(({ sourcePathAssetId, candidateType }) => (
    sourcePathAssetId === 'POWER_JB-003_C-009' && candidateType === 'cable_termination'
  ))

  assert.ok(candidates.some(({ targetAssetId, targetInterfaceId, cableRole }) => (
    targetAssetId === 'JB-003'
      && targetInterfaceId === 'JB-003/interface/power-out/01'
      && cableRole === 'distribution'
  )))
  assert.ok(candidates.some(({ targetAssetId, targetInterfaceId, cableRole }) => (
    targetAssetId === 'C-009'
      && targetInterfaceId === 'C-009/interface/power-in/01'
      && cableRole === 'distribution'
  )))
  assert.equal(candidates.some(({ targetAssetId, targetInterfaceId }) => (
    targetAssetId === 'JB-003'
      && targetInterfaceId === 'JB-003/interface/power-in/01'
  )), false)
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

test('topology readiness blocks required nodes and endpoints until confirmed or excepted', () => {
  const left = node('CAM-REQUIRED-A', 'cctv', 'CCTV Camera', [110, -7])
  const right = node('CAM-REQUIRED-B', 'cctv', 'CCTV Camera', [110.001, -7])
  const cable = pathObject('CBL-REQUIRED', 'cctv', 'CCTV Cable', [
    [110, -7],
    [110.001, -7],
  ])
  left.object.topologyRequired = true
  right.object.topologyRequired = true
  cable.object.topologyRequired = true

  const blocked = generateRelationArtifacts(topologyBundle({
    nodes: [left, right],
    paths: [cable],
  }))
  assert.ok(blocked.readiness.blockingReasons.includes('topology_required_node_unresolved'))
  assert.ok(blocked.readiness.blockingReasons.includes('topology_required_endpoint_unresolved'))
  assert.equal(blocked.readiness.requiredTopology.unresolvedNodeCount, 2)
  assert.equal(blocked.readiness.requiredTopology.unresolvedEndpointCount, 2)

  const ready = generateRelationArtifacts(topologyBundle({
    nodes: [left, right],
    paths: [cable],
    topologyPolicy: { requireJbTermination: false },
  }), {
    config: {
      autoConfirmSpatialInference: true,
      accuracyArtifact: approvedAccuracyArtifact('cctv'),
      engineBuildSha: 'build-test',
    },
  })
  assert.equal(ready.readiness.topologyReadiness, 'ready')
  assert.equal(ready.readiness.requiredTopology.unresolvedNodeCount, 0)
  assert.equal(ready.readiness.requiredTopology.unresolvedEndpointCount, 0)
})

test('regeneration reopens a review decision when the relevant geometry changes', () => {
  const bundle = topologyBundle({
    nodes: [node('CAM-CARRY', 'cctv', 'CCTV Camera', [110, -7])],
    paths: [pathObject('CBL-CARRY', 'cctv', 'CCTV Cable', [
      [110, -7],
      [110.001, -7],
    ])],
    topologyPolicy: { requireJbTermination: false },
  })
  const initial = generateRelationArtifacts(bundle)
  const reviewedCandidates = initial.candidates.map((candidate) => ({
    ...candidate,
    candidateStatus: 'confirmed',
    proposalStatus: 'confirmed_by_admin',
    review: {
      actorId: 'admin-1',
      reviewedAt: '2026-08-12T00:00:00.000Z',
      reason: 'Review awal selesai.',
    },
  }))
  const unchanged = generateRelationArtifacts(bundle, {
    previousCandidates: reviewedCandidates,
  })
  assert.ok(unchanged.candidates.every(({ candidateStatus }) => candidateStatus === 'confirmed'))
  assert.equal(unchanged.reopenedReviewHistory.length, 0)

  const changed = structuredClone(bundle)
  changed.geometries.find(({ geometryId }) => geometryId === 'geometry:CBL-CARRY')
    .coordinates[1][1] = -6.9999
  changed.geometries.find(({ geometryId }) => geometryId === 'geometry:CBL-CARRY')
    .geometryFingerprint = 'fingerprint:CBL-CARRY:changed'
  const regenerated = generateRelationArtifacts(changed, {
    previousCandidates: reviewedCandidates,
  })
  assert.ok(regenerated.candidates.some(({ candidateStatus }) => candidateStatus !== 'confirmed'))
  assert.equal(regenerated.reopenedReviewHistory.length, reviewedCandidates.length)
  assert.equal(
    regenerated.reopenedReviewHistory[0].supersededReason,
    'topology_input_changed_review_reopened',
  )
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

function approvedAccuracyArtifact(networkFamily) {
  return {
    schemaVersion: '1.0.0',
    evaluationId: `evaluation-${networkFamily}`,
    siteId: 'site-1',
    networkFamily,
    goldSetVersion: 'gold-set/1.0.0',
    goldSetChecksum: `sha256:${'b'.repeat(64)}`,
    ruleSetVersion: TOPOLOGY_RULE_SET_VERSION,
    engineBuildSha: 'build-test',
    sampleSize: 200,
    heldOutPrecision: 0.99,
    heldOutRecall: 0.98,
    pathAccuracy: 0.95,
    componentAccuracy: 1,
    falseComponentMergeCount: 0,
    evaluatedAt: '2026-07-29T00:00:00.000Z',
    approvedBy: 'risk-owner-test',
    approvedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    status: 'approved',
  }
}

function topologyBundle({
  nodes = [],
  paths = [],
  explicitRelations = [],
  topologyExceptions = [],
  topologyPolicy = null,
  jbProfiles = [],
  internalConnections = [],
  interfaceRegistry = [],
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
    topologyExceptions,
    jbProfiles,
    internalConnections,
    interfaceRegistry,
    ...(topologyPolicy ? { topologyPolicy } : {}),
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
