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
