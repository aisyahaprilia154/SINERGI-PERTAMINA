import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  calculateLeafletLabelVisibility,
  calculateLeafletMarkerLayout,
  isAssetVisibleAtZoom,
  isGeometryVisibleAtZoom,
  markerVisualPriority,
} from '../src/pages/map/leaflet-map-lod.js'
import { leafletMapLayerInternals } from '../src/pages/map/leaflet-map-layers.js'
import { deriveLeafletZoomThresholds } from '../src/pages/map/leaflet-map-state.js'

test('zoom tiers are derived from Pengapon fit zoom unless explicitly overridden', () => {
  assert.deepEqual(deriveLeafletZoomThresholds(15, {
    minZoom: 10,
    maxZoom: 22,
    lowZoomOffset: 0,
    highZoomOffset: 3,
  }), {
    fitZoom: 15,
    lowZoomMax: 15,
    highZoomMin: 18,
  })
  assert.deepEqual(deriveLeafletZoomThresholds(15, {
    minZoom: 10,
    maxZoom: 22,
    lowZoomMaxOverride: 14,
    highZoomMinOverride: 19,
  }), {
    fitZoom: 15,
    lowZoomMax: 14,
    highZoomMin: 19,
  })
})

test('node level of detail keeps focus and topology endpoints visible', () => {
  const core = { id: 'SW-CORE', type: 'Core switch', isCoreNode: true }
  const junction = { id: 'JB-01', type: 'Junction box', isCoreNode: false }
  const camera = { id: 'CCTV-01', type: 'CCTV', isCoreNode: false }

  assert.equal(isAssetVisibleAtZoom(core, 'low'), true)
  assert.equal(isAssetVisibleAtZoom(junction, 'low'), false)
  assert.equal(isAssetVisibleAtZoom(junction, 'medium'), true)
  assert.equal(isAssetVisibleAtZoom(camera, 'medium'), false)
  assert.equal(isAssetVisibleAtZoom(camera, 'high'), true)
  assert.equal(isAssetVisibleAtZoom(camera, 'low', {
    selectedAssetId: camera.id,
  }), true)
  assert.equal(isAssetVisibleAtZoom(camera, 'low', {
    traceNodeIds: [camera.id, core.id],
  }), true)
})

test('low zoom hides polygons while preserving line geometry', () => {
  assert.equal(isGeometryVisibleAtZoom({ geometryType: 'polygon' }, 'low'), false)
  assert.equal(isGeometryVisibleAtZoom({ geometryType: 'polygon' }, 'medium'), true)
  assert.equal(isGeometryVisibleAtZoom({ geometryType: 'line_string' }, 'low'), true)
})

test('line hierarchy remains function-based rather than scaling every line equally', () => {
  const backbone = leafletMapLayerInternals.lineStyle('fiber-backbone', 'medium')
  const distribution = leafletMapLayerInternals.lineStyle('fiber-distribution', 'medium')
  const minor = leafletMapLayerInternals.lineStyle('lan', 'medium')

  assert.ok(backbone.weight > distribution.weight)
  assert.ok(distribution.weight > minor.weight)
  assert.equal(backbone.dashArray, null)
  assert.equal(minor.dashArray, '9 7')
  assert.ok(
    leafletMapLayerInternals.lineStyle('fiber-backbone', 'high').weight
      - leafletMapLayerInternals.lineStyle('fiber-backbone', 'low').weight <= 1,
  )
})

test('identical coordinates use deterministic visual fan-out without source mutation', () => {
  const assets = [
    {
      id: 'JB-B',
      type: 'Junction box',
      coordinate: [110.43, -6.95],
    },
    {
      id: 'SW-CORE',
      type: 'Core switch',
      isCoreNode: true,
      coordinate: [110.43, -6.95],
    },
    {
      id: 'JB-A',
      type: 'Junction box',
      coordinate: [110.43, -6.95],
    },
  ]
  const before = structuredClone(assets)
  const records = assets.map((asset) => ({
    asset,
    point: { x: 220, y: 180 },
  }))
  const first = calculateLeafletMarkerLayout(records)
  const second = calculateLeafletMarkerLayout(records)

  assert.deepEqual([...first], [...second])
  assert.equal(first.get('SW-CORE').displaced, false)
  assert.equal(first.get('JB-A').displaced, true)
  assert.equal(first.get('JB-B').displaced, true)
  assert.deepEqual(assets, before)
})

test('nearby markers maintain a selectable screen-space distance', () => {
  const records = [
    {
      asset: { id: 'A', type: 'CCTV', coordinate: [110.4, -6.9] },
      point: { x: 100, y: 100 },
    },
    {
      asset: { id: 'B', type: 'CCTV', coordinate: [110.40001, -6.90001] },
      point: { x: 107, y: 105 },
    },
  ]
  const layout = calculateLeafletMarkerLayout(records, { minimumDistance: 30 })
  const pointA = {
    x: records[0].point.x + layout.get('A').offsetX,
    y: records[0].point.y + layout.get('A').offsetY,
  }
  const pointB = {
    x: records[1].point.x + layout.get('B').offsetX,
    y: records[1].point.y + layout.get('B').offsetY,
  }

  assert.ok(Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) >= 30)
  assert.ok(layout.get('B').leaderLength > 0 || layout.get('A').leaderLength > 0)
})

test('selected and trace labels win collision priority over regular labels', () => {
  const records = [
    {
      asset: { id: 'SELECTED', shortLabel: 'SELECTED', type: 'CCTV' },
      point: { x: 100, y: 100 },
    },
    {
      asset: {
        id: 'CORE',
        shortLabel: 'CORE-SWITCH',
        type: 'Core switch',
        isCoreNode: true,
      },
      point: { x: 105, y: 102 },
    },
  ]
  const layout = new Map(records.map(({ asset }) => [
    asset.id,
    { offsetX: 0, offsetY: 0 },
  ]))
  const labels = calculateLeafletLabelVisibility(records, layout, {
    selectedAssetId: 'SELECTED',
    zoomTier: 'medium',
  })

  assert.equal(markerVisualPriority(records[0].asset, {
    selectedAssetId: 'SELECTED',
  }) > markerVisualPriority(records[1].asset), true)
  assert.equal(labels.has('SELECTED'), true)
  assert.equal(labels.has('CORE'), false)
})

test('Leaflet updates LOD after stable move and zoom events without rebuilding topology', async () => {
  const renderer = await readFile(
    new URL('../src/pages/map/leaflet-map-renderer.js', import.meta.url),
    'utf8',
  )
  const layers = await readFile(
    new URL('../src/pages/map/leaflet-map-layers.js', import.meta.url),
    'utf8',
  )

  assert.match(renderer, /map\.on\('moveend'/)
  assert.match(renderer, /map\.on\('zoomend'/)
  assert.match(renderer, /scheduleLayerRefresh/)
  assert.match(layers, /calculateLeafletMarkerLayout/)
  assert.doesNotMatch(renderer, /buildTopologyGraph/)
  assert.doesNotMatch(layers, /buildTopologyGraph/)
})
