import assert from 'node:assert/strict'
import test from 'node:test'
import { edgeMatchesAssetScope, selectConfirmedComponent } from '../src/pages/map/topology-scope-builder.js'

test('scope builder rejects cross-site and cross-dataset relations', () => {
  const assets = new Map([
    ['a', { id: 'a', siteScopeId: 'site-a', datasetVersionId: 'v1' }],
    ['b', { id: 'b', siteScopeId: 'site-b', datasetVersionId: 'v1' }],
    ['c', { id: 'c', siteScopeId: 'site-a', datasetVersionId: 'v2' }],
  ])
  assert.equal(edgeMatchesAssetScope({ sourceId: 'a', targetId: 'b' }, assets), false)
  assert.equal(edgeMatchesAssetScope({ sourceId: 'a', targetId: 'c' }, assets), false)
})

test('scope builder chooses the focused component or largest component', () => {
  const edges = [
    { sourceId: 'a', targetId: 'b' },
    { sourceId: 'b', targetId: 'c' },
    { sourceId: 'x', targetId: 'y' },
  ]
  assert.deepEqual(selectConfirmedComponent(edges), ['a', 'b', 'c'])
  assert.deepEqual(selectConfirmedComponent(edges, 'x'), ['x', 'y'])
})
