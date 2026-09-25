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
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11.1'), ['JB-11.1', 'CAM-1'])
})

test('a descendant moved to another frame stays independent', () => {
  const nodes = [
    { id: 'JB-11.1', mountingBoxId: 'frame-a' },
    { id: 'CAM-1', parentId: 'JB-11.1', mountingBoxId: 'frame-b' },
    { id: 'CAM-2', parentId: 'JB-11.1', mountingBoxId: 'frame-a' },
  ]
  assert.deepEqual(frameMoveAssetIds(nodes, 'JB-11.1'), ['JB-11.1', 'CAM-2'])
})
