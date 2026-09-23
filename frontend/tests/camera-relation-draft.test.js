import assert from 'node:assert/strict'
import test from 'node:test'
import { stageCameraRelationReplacement } from '../src/domain/camera-relation-draft.js'

const nodes = [
  { id: 'cam', type: 'CCTV', assetType: 'CCTV' },
  { id: 'jb-old', type: 'Junction Box', assetType: 'Junction Box' },
  { id: 'jb-new', type: 'Junction Box', assetType: 'Junction Box' },
]

test('new camera JB relation stages removal of previous primary and cancel can restore snapshot', () => {
  const saved = { nodes, edges: [{ id: 'old', sourceAssetId: 'cam', targetAssetId: 'jb-old' }] }
  const replaced = stageCameraRelationReplacement({ graph: saved, changes: [], nodes,
    sourceAssetId: 'cam', targetAssetId: 'jb-new' })
  assert.deepEqual(replaced.graph.edges, [])
  assert.deepEqual(replaced.changes, [{ type: 'remove-edge', edgeId: 'old' }])
  assert.equal(saved.edges[0].id, 'old')
  const draft = { ...replaced.graph, edges: [...replaced.graph.edges,
    { id: 'new', sourceAssetId: 'cam', targetAssetId: 'jb-new' }] }
  assert.deepEqual(draft.edges.map(edge => edge.id), ['new'])
  assert.deepEqual(structuredClone(saved).edges.map(edge => edge.id), ['old'])
})

test('replacing an unsaved camera relation removes its add operation', () => {
  const draft = { nodes, edges: [{ id: 'draft-edge:one', sourceAssetId: 'cam', targetAssetId: 'jb-old' }] }
  const result = stageCameraRelationReplacement({ graph: draft,
    changes: [{ type: 'add-relation', draftEdgeId: 'draft-edge:one', sourceAssetId: 'cam', targetAssetId: 'jb-old' }],
    nodes, sourceAssetId: 'cam', targetAssetId: 'jb-new' })
  assert.deepEqual(result.graph.edges, [])
  assert.deepEqual(result.changes, [])
})
