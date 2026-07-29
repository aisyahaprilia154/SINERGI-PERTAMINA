import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateCanvasBackingStoreSize,
  clampMapZoom,
  createFrameScheduler,
  createViewportSubscriptionStore,
  geometryIntersectsGeographicBounds,
  getMapZoomTier,
  layoutViewportNodes,
  markerRadiusForZoom,
  markerRadiusForTier,
  pointerToCanvasCssPoint,
  screenViewportToGeographicBounds,
} from '../src/pages/map/map-viewport-layout.js'

test('zoom tiers expose progressively richer map detail', () => {
  assert.equal(getMapZoomTier(.65), 'low')
  assert.equal(getMapZoomTier(1), 'medium')
  assert.equal(getMapZoomTier(1.64), 'medium')
  assert.equal(getMapZoomTier(1.65), 'high')
  assert.equal(clampMapZoom(-2), .65)
  assert.equal(clampMapZoom(8), 3.2)
  assert.ok(markerRadiusForTier('low', false) < markerRadiusForTier('medium', false))
  assert.ok(markerRadiusForTier('medium', true) <= markerRadiusForTier('high', true))
  assert.ok(markerRadiusForZoom(.9, false) < markerRadiusForZoom(1.1, false))
  assert.ok(markerRadiusForZoom(1.1, false) < markerRadiusForZoom(2, false))
  assert.ok(markerRadiusForZoom(20, true) <= 13)
})

test('identical geographic coordinates are spiderfied at high zoom without mutation', () => {
  const nodes = [
    viewportNode('CAM-01', 200, 180, [110.42, -6.97]),
    viewportNode('CAM-02', 200, 180, [110.42, -6.97]),
    viewportNode('CAM-03', 200, 180, [110.42, -6.97]),
  ]
  const snapshot = structuredClone(nodes)

  const markers = layoutViewportNodes(nodes, {
    tier: 'high',
    selectedAssetId: 'CAM-02',
  })

  assert.deepEqual(nodes, snapshot)
  assert.equal(markers.length, 3)
  assert.equal(new Set(markers.map(({ x, y }) => `${x}:${y}`)).size, 3)
  assert.ok(markers.every(({ spiderfied, collisionCount }) => spiderfied && collisionCount === 3))
  assert.ok(markers.every(({ originalX, originalY }) => originalX === 200 && originalY === 180))
  assert.equal(markers.at(-1).asset.id, 'CAM-02')
})

test('nearby markers receive visual displacement and keep their original screen anchor', () => {
  const markers = layoutViewportNodes([
    viewportNode('SW-CORE', 300, 240, [110, -7], { core: true }),
    viewportNode('CAM-NEAR', 305, 243, [110.00001, -7.00001]),
  ], {
    tier: 'high',
    selectedAssetId: 'SW-CORE',
  })
  const camera = markers.find(({ asset }) => asset.id === 'CAM-NEAR')

  assert.equal(camera.originalX, 305)
  assert.equal(camera.originalY, 243)
  assert.equal(camera.displaced, true)
  assert.ok(Math.hypot(camera.x - 300, camera.y - 240) >= 25)
})

test('low and medium zoom cluster dense regular nodes while preserving core nodes', () => {
  const markers = layoutViewportNodes([
    viewportNode('CORE-01', 100, 100, [110, -7], { core: true }),
    viewportNode('CAM-01', 200, 200, [110.1, -7]),
    viewportNode('CAM-02', 206, 205, [110.10001, -7.00001]),
    viewportNode('CAM-03', 212, 202, [110.10002, -7.00002]),
  ], { tier: 'low' })

  assert.equal(markers.filter(({ kind }) => kind === 'cluster').length, 1)
  assert.equal(markers.find(({ kind }) => kind === 'cluster').count, 3)
  assert.ok(markers.some(({ asset }) => asset?.id === 'CORE-01'))
})

test('trace endpoints and important connector nodes remain selectable across LOD tiers', () => {
  const inputs = [
    viewportNode('TRACE-START', 100, 100, [110, -7], { traceEndpoint: true }),
    viewportNode('SW-01', 105, 103, [110.00001, -7], { important: true }),
    viewportNode('CAM-01', 110, 106, [110.00002, -7]),
  ]
  const low = layoutViewportNodes(inputs, { tier: 'low' })
  const medium = layoutViewportNodes(inputs, { tier: 'medium' })

  assert.ok(low.some(({ asset }) => asset?.id === 'TRACE-START'))
  assert.ok(medium.some(({ asset }) => asset?.id === 'TRACE-START'))
  assert.ok(medium.some(({ asset }) => asset?.id === 'SW-01'))
})

test('viewport layout handles more than 1000 nodes without losing asset identity', () => {
  const nodes = Array.from({ length: 1200 }, (_, index) => viewportNode(
    `ASSET-${index}`,
    (index % 40) * 12,
    Math.floor(index / 40) * 12,
    [110 + index / 100000, -7],
  ))

  const mediumMarkers = layoutViewportNodes(nodes, { tier: 'medium' })
  const representedAssetIds = mediumMarkers.flatMap((marker) => (
    marker.kind === 'cluster'
      ? marker.assets.map(({ id }) => id)
      : [marker.asset.id]
  ))
  const highMarkers = layoutViewportNodes(nodes, { tier: 'high' })

  assert.equal(representedAssetIds.length, 1200)
  assert.equal(new Set(representedAssetIds).size, 1200)
  assert.ok(mediumMarkers.length < nodes.length)
  assert.equal(highMarkers.length, 1200)
  assert.equal(new Set(highMarkers.map(({ asset }) => asset.id)).size, 1200)
})

test('rapid zoom scheduling is coalesced into one animation frame', () => {
  const callbacks = []
  let drawCount = 0
  const scheduler = createFrameScheduler(
    (callback) => {
      callbacks.push(callback)
      return callbacks.length
    },
    () => {},
    () => {
      drawCount += 1
    },
  )

  for (let index = 0; index < 100; index += 1) scheduler.schedule()

  assert.equal(callbacks.length, 1)
  assert.equal(scheduler.pending, true)
  callbacks[0]()
  assert.equal(drawCount, 1)
  assert.equal(scheduler.pending, false)
})

test('viewport subscribers receive one shared geographic and visibility snapshot', () => {
  const events = []
  const subscriptions = createViewportSubscriptionStore(
    (bounds, detail) => events.push({ source: 'initial', bounds, detail }),
  )
  const unsubscribe = subscriptions.subscribe(
    (bounds, detail) => events.push({ source: 'dynamic', bounds, detail }),
  )
  const bounds = { minLng: 110, minLat: -7, maxLng: 111, maxLat: -6 }
  const detail = {
    visibleAssetIds: ['A'],
    visibleGeometryIds: ['LINE-A'],
    zoom: 1.2,
    zoomTier: 'medium',
  }

  subscriptions.notify(bounds, detail)
  unsubscribe()
  subscriptions.notify(bounds, detail)

  assert.deepEqual(events.map(({ source }) => source), [
    'initial',
    'dynamic',
    'initial',
  ])
  assert.strictEqual(events[0].bounds, bounds)
  assert.strictEqual(events[0].detail, detail)
})

test('Canvas viewport corners are inverse-projected into geographic bounds', () => {
  const bounds = screenViewportToGeographicBounds({
    width: 1000,
    height: 600,
    zoom: 2,
    pan: { x: 100, y: -60 },
    dataBounds: {
      west: 110,
      east: 111,
      south: -7.5,
      north: -6.5,
    },
  })

  assert.equal(bounds.corners.length, 4)
  assert.ok(bounds.west > 110)
  assert.ok(bounds.east < 111)
  assert.ok(bounds.south > -7.5)
  assert.ok(bounds.north < -6.5)
  assert.ok(bounds.west < bounds.east)
  assert.ok(bounds.south < bounds.north)
  assert.equal(bounds.minLng, bounds.west)
  assert.equal(bounds.maxLng, bounds.east)
  assert.equal(bounds.minLat, bounds.south)
  assert.equal(bounds.maxLat, bounds.north)
})

test('geographic geometry selection includes paths crossing the viewport', () => {
  const bounds = {
    west: 110,
    east: 111,
    south: -7.5,
    north: -6.5,
  }

  assert.equal(geometryIntersectsGeographicBounds(
    [[109.5, -7], [111.5, -7]],
    bounds,
  ), true)
  assert.equal(geometryIntersectsGeographicBounds(
    [[108, -8], [109, -8]],
    bounds,
  ), false)
  assert.equal(geometryIntersectsGeographicBounds(
    [110.4, -7.1],
    bounds,
  ), true)
})

test('Canvas backing store and pointer coordinates remain correct above DPR 1', () => {
  assert.deepEqual(calculateCanvasBackingStoreSize({
    cssWidth: 800,
    cssHeight: 450,
    devicePixelRatio: 2,
  }), {
    cssWidth: 800,
    cssHeight: 450,
    pixelWidth: 1600,
    pixelHeight: 900,
    ratio: 2,
  })
  assert.deepEqual(pointerToCanvasCssPoint({
    clientX: 410,
    clientY: 245,
    rect: {
      left: 10,
      top: 20,
      width: 1000,
      height: 562.5,
    },
    cssWidth: 800,
    cssHeight: 450,
  }), {
    x: 320,
    y: 180,
  })
})

function viewportNode(id, x, y, coordinate, overrides = {}) {
  return {
    x,
    y,
    asset: {
      id,
      coordinate,
    },
    active: true,
    connected: false,
    core: false,
    important: false,
    ...overrides,
  }
}
