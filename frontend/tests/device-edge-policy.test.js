import assert from 'node:assert/strict'
import test from 'node:test'
import { filterConflictingCameraEdges } from '../src/domain/device-edge-policy.js'

test('map projection removes proximity-only JB edge when camera has path evidence', () => {
  const nodes = [
    { id: 'JB-03', objectRole: 'device_node', assetType: 'junction box' },
    { id: 'CAM-22', objectRole: 'device_node', assetType: 'cctv' },
    { id: 'JB-08', objectRole: 'device_node', assetType: 'junction box' },
  ]
  const edges = filterConflictingCameraEdges([
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
    },
  ], nodes)

  assert.deepEqual(edges.map(({ id }) => id), ['edge:jb03-cam22'])
})
