import assert from 'node:assert/strict'
import test from 'node:test'
import { frameMoveAssetIds } from '../src/pages/topology/topology-frame-descendants.js'

test('moving a child JB carries its descendants in the same frame', () => {
  const nodes = [
    { id: 'JB-11', mountingBoxId: 'frame-a' },
    { id: 'JB-11.1', parentId: 'JB-11', mountingBoxId: 'frame-a' },
    { id: 'CAM-1', parentId: 'JB-11.1', mountingBoxId: 'frame-a' },
    { id: 'CAM-2', parentId: 'JB-11', mountingBoxId: 'frame-a' },
  ]
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11.1', [
    { sourceAssetId: 'JB-11.1', targetAssetId: 'T-001' },
    { sourceAssetId: 'CAM-1', targetAssetId: 'T-001' },
  ]), ['JB-11.1', 'CAM-1'])
})

test('a descendant moved to another frame stays independent', () => {
  const nodes = [
    { id: 'JB-11.1', mountingBoxId: 'frame-a' },
    { id: 'CAM-1', parentId: 'JB-11.1', mountingBoxId: 'frame-b' },
    { id: 'CAM-2', parentId: 'JB-11.1', mountingBoxId: 'frame-a' },
  ]
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11.1', [
    { sourceAssetId: 'JB-11.1', targetAssetId: 'T-001' },
    { sourceAssetId: 'CAM-1', targetAssetId: 'T-002' },
    { sourceAssetId: 'CAM-2', targetAssetId: 'T-001' },
  ]), ['JB-11.1', 'CAM-2'])
})

test('a child JB on another pole never follows its parent despite a shared visual frame', () => {
  const nodes = [
    { id: 'JB-11', mountingBoxId: 'visual-frame' },
    { id: 'JB-11.1', parentId: 'JB-11', mountingBoxId: 'visual-frame' },
    { id: 'CAM-1', parentId: 'JB-11.1', mountingBoxId: 'visual-frame' },
    { id: 'CAM-2', parentId: 'JB-11', mountingBoxId: 'visual-frame' },
  ]
  const mountingRelations = [
    { sourceAssetId: 'JB-11', targetAssetId: 'T-001' },
    { sourceAssetId: 'JB-11.1', targetAssetId: 'T-002' },
    { sourceAssetId: 'CAM-1', targetAssetId: 'T-002' },
    { sourceAssetId: 'CAM-2', targetAssetId: 'T-001' },
  ]
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11', mountingRelations), ['JB-11', 'CAM-2'])
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11.1', mountingRelations), ['JB-11.1', 'CAM-1'])
})

test('unmounted descendants do not follow a JB onto a pole', () => {
  const nodes = [
    { id: 'JB-11', mountingBoxId: 'unassigned' },
    { id: 'CAM-1', parentId: 'JB-11', mountingBoxId: 'unassigned' },
  ]
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11'), ['JB-11'])
})
