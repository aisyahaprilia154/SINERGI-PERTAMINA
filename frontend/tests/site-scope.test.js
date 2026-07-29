import assert from 'node:assert/strict'
import test from 'node:test'
import {
  scopeDatasetToSite,
} from '../src/adapters/active-dataset-map-adapter.js'
import {
  DEFAULT_SITE_SCOPE_ID,
  normalizeSourceFolderPath,
  resolveSiteScope,
  scopeActiveDatasetRecordsToSite,
  sourceFolderMatchesSite,
} from '../src/domain/site-scope.js'
import { serializeActiveDatasetKml } from '../src/pages/map/active-dataset-kml-export.js'
import { buildExplicitRelationGraph } from '../src/pages/map/network-tracing.js'
import { parseMapUrlState, serializeMapUrlState } from '../src/pages/map/network-sidebar-state.js'
import { buildSchematicGraph } from '../src/pages/map/schematic-graph.js'

test('Pengapon aliases match case-insensitively with normalized slash and repeated spaces', () => {
  assert.equal(
    normalizeSourceFolderPath('\\RJBT\\  FT   PENGAPON - SEMARANG \\ CCTV  '),
    '/rjbt/ft pengapon - semarang/cctv',
  )
  assert.equal(
    sourceFolderMatchesSite('/rjbt/ft pengapon - semarang/CCTV', 'pengapon'),
    true,
  )
  assert.equal(
    sourceFolderMatchesSite('/RJBT//FT   PENGAPON///LAN', 'PENGAPON'),
    true,
  )
})

test('other RJBT sites and unmapped objects never enter the Pengapon scope', () => {
  const scoped = scopeActiveDatasetRecordsToSite(createSiteFixture(), 'pengapon')
  const ids = scoped.assets.map(({ assetId }) => assetId)

  assert.deepEqual(ids.sort(), ['CAM-PNG-01', 'LINE-PNG-01', 'SW-PNG-01'])
  for (const excludedId of ['CAM-REW-01', 'CAM-MAOS-01', 'CAM-CLP-01', 'CAM-YIA-01', 'NO-SITE-01']) {
    assert.equal(ids.includes(excludedId), false)
  }
  assert.ok(scoped.layers.every(({ sourceFolderPath }) => (
    /pengapon/i.test(sourceFolderPath)
  )))
})

test('Pengapon geometry remains available and projection uses only scoped coordinates', () => {
  const result = scopeDatasetToSite(createSiteFixture(), 'pengapon')

  assert.equal(result.counts.assetNodeCount, 2)
  assert.equal(result.counts.lineCount, 1)
  assert.equal(result.counts.polygonCount, 0)
  assert.equal(result.geometries.length, 3)
  assert.deepEqual(result.scopedBounds, [110, -7, 110.001, -7])
  assert.ok(result.assets.every(({ siteScopeId }) => siteScopeId === 'pengapon'))
  assert.ok(result.geometries.every(({ siteScopeName }) => siteScopeName === 'Pengapon'))
})

test('cross-site relations are removed before the scoped topology graph is built', () => {
  const result = scopeDatasetToSite(createSiteFixture(), 'pengapon')

  assert.ok(result.topologyGraph.edges.some((edge) => (
    edge.sourceNodeId === 'CAM-PNG-01' && edge.targetNodeId === 'SW-PNG-01'
  )))
  assert.ok(result.topologyGraph.edges.every((edge) => (
    !edge.sourceNodeId.includes('REW') && !edge.targetNodeId.includes('REW')
  )))
  assert.equal(result.scopeSummary.sourceRelationCount, 2)
  assert.equal(result.scopeSummary.scopedRelationCount, 1)
  assert.equal(result.scopeSummary.excludedRelationCount, 1)
})

test('map, sidebar, tracing, diagram, viewport input, and contextual export share one scope', () => {
  const result = scopeDatasetToSite(createSiteFixture(), 'pengapon')
  const mapAssetIds = new Set(result.assets.map(({ id }) => id))
  const sidebarAssetIds = new Set(result.networks.flatMap(({ nodeIds }) => nodeIds))
  const tracingGraph = buildExplicitRelationGraph({
    networks: result.networks,
    assetIds: [...mapAssetIds],
    topologyGraph: result.topologyGraph,
  })
  const diagram = buildSchematicGraph({
    assets: result.assets,
    networks: result.networks,
    topologyGraph: result.topologyGraph,
    scope: 'full-map',
  })
  const kml = serializeActiveDatasetKml({
    activeContext: result.activeContext,
    assets: result.exportAssets,
    relations: result.topologyGraph.edges,
  })

  assert.equal(result.scopedAssets, result.assets)
  assert.equal(result.scopedGeometries, result.geometries)
  assert.equal(result.scopedNetworks, result.networks)
  assert.equal(result.scopedTopologyGraph, result.topologyGraph)
  assert.deepEqual(sidebarAssetIds, mapAssetIds)
  assert.ok([...tracingGraph.keys()].every((id) => mapAssetIds.has(id)))
  assert.ok(diagram.nodes.every(({ id }) => mapAssetIds.has(id)))
  assert.ok(result.assets.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
  assert.match(kml, /CAM-PNG-01/)
  assert.doesNotMatch(kml, /CAM-REW-01|CAM-MAOS-01|CAM-CLP-01|CAM-YIA-01/)
})

test('invalid or missing URL scope falls back safely to Pengapon and refresh preserves it', () => {
  assert.equal(resolveSiteScope('unknown-site').id, DEFAULT_SITE_SCOPE_ID)
  const validIds = {
    networkIds: ['network:cctv'],
    assetIds: ['CAM-PNG-01'],
    defaultNetworkIds: ['network:cctv'],
  }
  const missing = parseMapUrlState('?branchId=semarang', validIds)
  const invalid = parseMapUrlState('?siteScopeId=rewulu', validIds)
  const serialized = serializeMapUrlState('?datasetId=dataset-semarang&branchId=semarang', {
    ...missing,
    selectedNetworkIds: new Set(missing.selectedNetworkIds),
  })

  assert.equal(missing.siteScopeId, 'pengapon')
  assert.equal(invalid.siteScopeId, 'pengapon')
  assert.equal(new URLSearchParams(serialized).get('siteScopeId'), 'pengapon')
  assert.equal(new URLSearchParams(serialized).get('branchId'), 'semarang')
})

test('scoping prevents a whole-dataset node count from leaking into the Pengapon map', () => {
  const fixture = createSiteFixture()
  const unscoped = scopeDatasetToSite({
    ...fixture,
    layers: fixture.layers.map((layer) => ({
      ...layer,
      sourceFolderPath: `/RJBT/FT PENGAPON/${layer.name}`,
    })),
  }, 'pengapon')
  const scoped = scopeDatasetToSite(fixture, 'pengapon')

  assert.ok(unscoped.counts.assetNodeCount > scoped.counts.assetNodeCount)
  assert.equal(scoped.counts.assetNodeCount, 2)
  assert.notEqual(scoped.counts.assetNodeCount, 449)
})

function createSiteFixture() {
  const siteLayers = [
    layer('layer-pengapon-cctv', 'CCTV', '/RJBT/FT PENGAPON - SEMARANG/CCTV', 'CCTV'),
    layer('layer-pengapon-lan', 'LAN', '/rjbt/ft   pengapon/LAN', 'LAN'),
    layer('layer-rewulu', 'Rewulu', '/RJBT/FT REWULU/CCTV', 'CCTV'),
    layer('layer-maos', 'Maos', '/RJBT/FT MAOS/CCTV', 'CCTV'),
    layer('layer-cilacap', 'Cilacap', '/RJBT/FT CILACAP/CCTV', 'CCTV'),
    layer('layer-yia', 'YIA', '/RJBT/DPPU YIA/CCTV', 'CCTV'),
    layer('layer-unmapped', 'Tanpa site', '/LAINNYA/CCTV', 'CCTV'),
  ]
  const siteAssets = [
    asset('node-png-camera', 'CAM-PNG-01', 'layer-pengapon-cctv', 'CCTV', 'CCTV'),
    asset('node-png-switch', 'SW-PNG-01', 'layer-pengapon-lan', 'Infrastructure', 'Switch'),
    asset('node-png-line', 'LINE-PNG-01', 'layer-pengapon-lan', 'LAN', 'LAN cable'),
    asset('node-rewulu', 'CAM-REW-01', 'layer-rewulu', 'CCTV', 'CCTV'),
    asset('node-maos', 'CAM-MAOS-01', 'layer-maos', 'CCTV', 'CCTV'),
    asset('node-cilacap', 'CAM-CLP-01', 'layer-cilacap', 'CCTV', 'CCTV'),
    asset('node-yia', 'CAM-YIA-01', 'layer-yia', 'CCTV', 'CCTV'),
    asset('node-unmapped', 'NO-SITE-01', 'layer-unmapped', 'CCTV', 'CCTV'),
  ]
  return {
    activePointer: {
      revision: 'scope-revision',
      activatedAt: '2026-07-28T09:00:00.000Z',
    },
    datasetVersion: {
      id: 'version-active',
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      versionName: 'doc · 28 Jul 2026',
      sourceFilename: 'doc.kml',
    },
    layers: siteLayers,
    assets: siteAssets,
    geometries: [
      point('point-png-camera', 'node-png-camera', 110, -7),
      point('point-png-switch', 'node-png-switch', 110.001, -7),
      {
        id: 'line-png',
        assetNodeId: 'node-png-line',
        geometryType: 'line_string',
        coordinates: [[110, -7], [110.001, -7]],
      },
      point('point-rewulu', 'node-rewulu', 110.5, -7.5),
      point('point-maos', 'node-maos', 109.2, -7.6),
      point('point-cilacap', 'node-cilacap', 109.1, -7.7),
      point('point-yia', 'node-yia', 110.05, -7.9),
      point('point-unmapped', 'node-unmapped', 111, -8),
    ],
    relations: [{
      id: 'relation-pengapon',
      sourceAssetId: 'CAM-PNG-01',
      targetAssetId: 'SW-PNG-01',
      relationType: 'connected_to',
    }, {
      id: 'relation-cross-site',
      sourceAssetId: 'CAM-PNG-01',
      targetAssetId: 'CAM-REW-01',
      relationType: 'connected_to',
    }],
  }
}

function layer(id, name, sourceFolderPath, category) {
  return {
    id,
    name,
    sourceFolderPath,
    category,
    displayOrder: 0,
    defaultVisible: true,
  }
}

function asset(id, assetId, layerId, category, type) {
  return {
    id,
    assetId,
    layerId,
    datasetVersionId: 'version-active',
    branchId: 'semarang',
    name: assetId,
    category,
    type,
    properties: {},
  }
}

function point(id, assetNodeId, longitude, latitude) {
  return {
    id,
    assetNodeId,
    geometryType: 'point',
    coordinates: [longitude, latitude],
  }
}
