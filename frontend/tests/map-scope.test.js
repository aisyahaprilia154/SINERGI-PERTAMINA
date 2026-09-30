import assert from 'node:assert/strict'
import test from 'node:test'
import { scopeMapData } from '../src/pages/map/map-page.js'

test('area scope keeps geometry order, network counts, and pole mounting', () => {
  const assets = [
    { id: 'pole', locationGroupKey: 'site-a' },
    { id: 'camera', locationGroupKey: 'site-a' },
    { id: 'remote', locationGroupKey: 'site-b' },
  ]
  const geometries = [
    { id: 'pole-point', assetId: 'pole', locationGroupKey: 'site-a', geometryType: 'point' },
    { id: 'camera-line', assetId: 'camera', locationGroupKey: 'site-a', geometryType: 'line_string' },
    { id: 'remote-line', assetId: 'remote', locationGroupKey: 'site-b', geometryType: 'line_string' },
  ]
  const mounting = { sourceAssetId: 'camera', targetAssetId: 'pole' }
  const result = scopeMapData({
    selectedArea: { key: 'site-a' },
    assets,
    diagramAssets: assets,
    geometries,
    exportAssets: assets,
    networks: [{
      id: 'network',
      nodeIds: ['pole', 'camera', 'remote'],
      geometryIds: ['camera-line', 'pole-point', 'remote-line'],
      relations: [],
    }],
    topologyGraph: { nodes: [], edges: [] },
    mountingRelations: [mounting],
    poleGroups: [{ poleAssetId: 'pole', assetIds: ['pole', 'camera'], assets: assets.slice(0, 2) }],
  })

  assert.deepEqual(result.networks[0].geometryAssetIds, ['pole', 'camera'])
  assert.equal(result.networks[0].lineCount, 1)
  assert.deepEqual(result.poleGroups[0].relations, [mounting])
  assert.equal(result.poleGroups[0].childCount, 1)
  assert.deepEqual(result.assets.map(({ id }) => id), ['pole', 'camera'])
})
