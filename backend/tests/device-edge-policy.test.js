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

test('path-backed camera edge wins over nearest-junction edge', () => {
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

  assert.deepEqual(result.edges.map(({ id }) => id), ['edge:jb03-cam22'])
  assert.equal(result.suppressedEdges[0].cameraAssetId, 'CAM-22')
})

test('nearest-junction candidate is demoted before materialization', () => {
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

  const nearest = result.find(({ candidateId }) => candidateId === 'candidate:nearest-jb')
  assert.equal(nearest.candidateStatus, 'ambiguous')
  assert.equal(nearest.proposalStatus, 'superseded_by_stronger_evidence')
  assert.deepEqual(nearest.conflictResolution.strongerCandidateIds, ['candidate:line-label'])
})
