import assert from 'node:assert/strict'
import test from 'node:test'
import { getDeviceSearchResults, relationTargetsFor } from '../src/domain/topology-search.js'
import {
  normalizeSearchText,
  searchMatchScore,
} from '../src/domain/search-normalization.js'

test('normalizes asset search separators, case, and diacritics', () => {
  assert.equal(normalizeSearchText('  JB—015 / Kamera Á  '), 'jb 015 kamera a')
  assert.ok(searchMatchScore(['JB-015'], 'jb 15') > 0)
  assert.ok(searchMatchScore(['C-015'], 'c015') > 0)
})

test('allows a small typo while keeping unrelated values out', () => {
  assert.ok(searchMatchScore(['JB-015'], 'JB-016') > 0)
  assert.equal(searchMatchScore(['JB-015'], 'router-99'), 0)
})

test('diagram search matches compact and zero-padded names and ranks exact results first', () => {
  const nodes = [
    { id: 'asset-19', name: 'JB-019-WP', areaKey: 'facility' },
    { id: 'asset-20', name: 'JB-020-WP', areaKey: 'facility' },
  ]
  const model = { nodes, nodeById: new Map(nodes.map(node => [node.id, node])), edges: [], mountingGroups: [] }
  for (const query of ['jb19wp', ' JB 19 WP ', 'jb_019_wp', '019 wp jb']) {
    assert.equal(getDeviceSearchResults(model, query)[0]?.id, 'asset-19', query)
  }
  assert.deepEqual(getDeviceSearchResults(model, 'router99'), [])
})

test('relation search uses normalized names while excluding connected and other-facility assets', () => {
  const nodes = [
    { id: 'source', name: 'Camera', areaKey: 'a' },
    { id: 'target', name: 'JB-019-WP', areaKey: 'a' },
    { id: 'connected', name: 'JB-019-WP', areaKey: 'a' },
    { id: 'other-area', name: 'JB-019-WP', areaKey: 'b' },
  ]
  const model = { nodes, nodeById: new Map(nodes.map(node => [node.id, node])), adjacency: new Map([['source', [{ id: 'connected' }]]]) }
  assert.deepEqual(relationTargetsFor(model, 'source', 'jb19wp').map(node => node.id), ['target'])
  assert.deepEqual(relationTargetsFor(model, 'source', '---'), [])
})
