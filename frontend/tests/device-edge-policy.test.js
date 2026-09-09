import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterConflictingCameraEdges,
  filterDppuYiaPresentationEdges,
} from '../src/domain/device-edge-policy.js'

test('map projection keeps geometry-first camera termination over conflicting label', () => {
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

  assert.deepEqual(edges.map(({ id }) => id), ['edge:cam22-jb08'])
})

test('DPPU YIA projection removes the documented JB-08 to JB-09.1 false positive only', () => {
  const assets = [
    { id: 'jb08', name: 'JB-CCTV-08-WP', locationGroupKey: 'dppu-yia' },
    { id: 'jb091', name: 'JB-CCTV-09.1-WP', locationGroupKey: 'dppu-yia' },
    { id: 'jb09', name: 'JB-CCTV-09-WP', locationGroupKey: 'dppu-yia' },
    { id: 'jb-other', name: 'JB-CCTV-08-WP', locationGroupKey: 'other-area' },
  ]
  const edges = filterDppuYiaPresentationEdges([
    { id: 'bad', sourceAssetId: 'jb08', targetAssetId: 'jb091' },
    { id: 'parent', sourceAssetId: 'jb09', targetAssetId: 'jb091' },
    { id: 'other-area', sourceAssetId: 'jb-other', targetAssetId: 'jb091' },
  ], assets)

  assert.deepEqual(edges.map(({ id }) => id), ['parent', 'other-area'])
})
