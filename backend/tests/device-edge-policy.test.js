import assert from 'node:assert/strict'
import test from 'node:test'
import {
  demoteConflictingCameraCandidates,
  filterConflictingCameraEdges,
} from '../src/topology/device-edge-policy.js'

const nodes = [
  { id: 'JB-03', objectRole: 'device_node', assetType: 'junction box', category: 'junction_box' },
  { id: 'CAM-22', objectRole: 'device_node', assetType: 'cctv', category: 'cctv_camera' },
  { id: 'JB-08', objectRole: 'device_node', assetType: 'junction box', category: 'junction_box' },
]

test('strong geometry wins over conflicting line-label camera edge', () => {
  const result = filterConflictingCameraEdges([
    {
      id: 'edge:jb03-cam22',
      sourceAssetId: 'JB-03',
      targetAssetId: 'CAM-22',
      relationKind: 'device_edge',
      relationSource: 'line_label_inference',
      pathAssetId: 'CABLE-22',
    },
    {
      id: 'edge:cam22-jb08',
      sourceAssetId: 'CAM-22',
      targetAssetId: 'JB-08',
      relationKind: 'device_edge',
      relationSource: 'spatial_inference',
      candidateType: 'device_nearest_junction',
    },
  ], nodes)

  assert.deepEqual(result.edges.map(({ id }) => id), ['edge:cam22-jb08'])
  assert.equal(result.suppressedEdges[0].cameraAssetId, 'CAM-22')
  assert.equal(result.suppressedEdges[0].reason, 'label_geometry_conflict')
})

test('line-label candidate is demoted before geometry materialization', () => {
  const result = demoteConflictingCameraCandidates([
    {
      candidateId: 'candidate:line-label',
      candidateType: 'line_label_connection',
      sourcePathAssetId: 'JB-03',
      targetAssetId: 'CAM-22',
      sourceObjectRole: 'device_node',
      targetObjectRole: 'device_node',
      relationKind: 'device_edge',
      candidateStatus: 'candidate',
    },
    {
      candidateId: 'candidate:nearest-jb',
      candidateType: 'device_nearest_junction',
      sourcePathAssetId: 'CAM-22',
      targetAssetId: 'JB-08',
      sourceObjectRole: 'device_node',
      targetObjectRole: 'device_node',
      relationKind: 'device_edge',
      candidateStatus: 'confirmed',
    },
  ], nodes)

  const label = result.find(({ candidateId }) => candidateId === 'candidate:line-label')
  const nearest = result.find(({ candidateId }) => candidateId === 'candidate:nearest-jb')
  assert.equal(nearest.candidateStatus, 'confirmed')
  assert.equal(label.candidateStatus, 'ambiguous')
  assert.equal(label.proposalStatus, 'superseded_by_stronger_evidence')
  assert.equal(label.conflictResolution.code, 'label_geometry_conflict')
  assert.deepEqual(label.conflictResolution.strongerCandidateIds, ['candidate:nearest-jb'])
})

test('locked manual camera relation remains stronger than geometry', () => {
  const result = filterConflictingCameraEdges([{
    id: 'edge:manual',
    sourceAssetId: 'CAM-22',
    targetAssetId: 'JB-03',
    relationKind: 'device_edge',
    relationSource: 'manual_admin',
  }, {
    id: 'edge:geometry',
    sourceAssetId: 'CAM-22',
    targetAssetId: 'JB-08',
    relationKind: 'device_edge',
    relationSource: 'spatial_inference',
    distanceMeters: 1,
  }], nodes)

  assert.deepEqual(result.edges.map(({ id }) => id), ['edge:manual'])
  assert.equal(result.suppressedEdges[0].reason, 'single_operational_camera_termination')
})

test('Cam-22 selects co-mounted JB-08 over independent JB-03', () => {
  const edges = [
    { id: 'cam03', sourceAssetId: 'CAM-22', targetAssetId: 'JB-03', relationSource: 'spatial_inference' },
    { id: 'cam08', sourceAssetId: 'CAM-22', targetAssetId: 'JB-08', relationSource: 'spatial_inference' },
  ]
  const mountingRelations = ['CAM-22', 'JB-08'].map(sourceAssetId => ({
    sourceAssetId, targetAssetId: 'T-10', verificationStatus: 'confirmed',
  }))
  const result = filterConflictingCameraEdges(edges, nodes, { mountingRelations })
  assert.deepEqual(result.edges.map(edge => edge.id), ['cam08'])
  assert.deepEqual(result.suppressedEdges.map(item => item.suppressedEdgeId), ['cam03'])
})

test('camera chooses JB child while preserving JB-to-parent backbone', () => {
  const localNodes = [
    { id: 'CAM-14', assetType: 'cctv' },
    { id: 'JB-02.2', name: 'JB-02.2', assetType: 'junction box' },
    { id: 'JB-02', name: 'JB-02', assetType: 'junction box' },
    { id: 'SERVER', assetType: 'server' },
  ]
  const edges = [
    { id: 'camera-parent', sourceAssetId: 'CAM-14', targetAssetId: 'JB-02', relationSource: 'spatial_inference' },
    { id: 'camera-child', sourceAssetId: 'CAM-14', targetAssetId: 'JB-02.2', relationSource: 'spatial_inference' },
    { id: 'child-parent', sourceAssetId: 'JB-02.2', targetAssetId: 'JB-02' },
    { id: 'parent-server', sourceAssetId: 'JB-02', targetAssetId: 'SERVER' },
  ]
  assert.deepEqual(filterConflictingCameraEdges(edges, localNodes).edges.map(edge => edge.id),
    ['camera-child', 'child-parent', 'parent-server'])
})

test('equally supported independent JBs require review and leave source evidence intact', () => {
  const evidence = [
    { id: 'one', sourceAssetId: 'CAM-22', targetAssetId: 'JB-03', relationSource: 'spatial_inference' },
    { id: 'two', sourceAssetId: 'CAM-22', targetAssetId: 'JB-08', relationSource: 'spatial_inference' },
  ]
  const result = filterConflictingCameraEdges(evidence, nodes)
  assert.deepEqual(result.edges, [])
  assert.equal(result.suppressedEdges.every(item => item.reason === 'camera_primary_requires_review'), true)
  assert.equal(evidence.length, 2)
})

test('a newer manual correction replaces the older independent camera JB choice', () => {
  const result = filterConflictingCameraEdges([
    { id: 'old', sourceAssetId: 'CAM-22', targetAssetId: 'JB-03',
      relationSource: 'manual_admin', manualConfirmation: { reviewedAt: '2026-09-01T00:00:00Z' } },
    { id: 'new', sourceAssetId: 'CAM-22', targetAssetId: 'JB-08',
      relationSource: 'manual_admin', manualConfirmation: { reviewedAt: '2026-09-02T00:00:00Z' } },
  ], nodes)
  assert.deepEqual(result.edges.map(edge => edge.id), ['new'])
  assert.equal(result.suppressedEdges[0].suppressedEdgeId, 'old')
})

test('two pieces of evidence for the same camera JB draw only one line', () => {
  const result = filterConflictingCameraEdges([
    { id: 'label', sourceAssetId: 'CAM-22', targetAssetId: 'JB-08',
      relationSource: 'line_label_inference' },
    { id: 'geometry', sourceAssetId: 'CAM-22', targetAssetId: 'JB-08',
      relationSource: 'spatial_inference' },
  ], nodes)
  assert.deepEqual(result.edges.map(edge => edge.id), ['geometry'])
  assert.equal(result.suppressedEdges[0].reason, 'duplicate_camera_termination_evidence')
})
