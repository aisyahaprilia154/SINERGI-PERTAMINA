import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  collectTraceGeographicPositions,
  collectGeographicPositions,
  expandLeafletGeometryParts,
  geometryToLeafletLatLngs,
  isNetworkVisible,
  leafletBoundsToGeographic,
  leafletZoomTier,
  resolveLeafletMapConfig,
  toLeafletLatLng,
} from '../src/pages/map/leaflet-map-state.js'
import { leafletMapLayerInternals } from '../src/pages/map/leaflet-map-layers.js'
import { renderNetworkMapSurface } from '../src/pages/map/map-surface.js'

test('basemap providers have a token-free primary and two ordered fallbacks', () => {
  const config = resolveLeafletMapConfig({
    runtimeConfig: {
      MAP_MIN_ZOOM: '11',
      MAP_MAX_ZOOM: '20',
    },
    environment: {},
  })
  assert.deepEqual(
    config.basemapProviders.map(({ id }) => id),
    ['carto-positron', 'carto-voyager', 'openstreetmap-standard'],
  )
  assert.ok(config.basemapProviders.every(({ url }) => url.startsWith('https://')))
  assert.ok(config.basemapProviders.every(({ token }) => token === ''))
  assert.deepEqual(
    config.satelliteBasemapProviders.map(({ id }) => id),
    ['esri-world-imagery'],
  )
  assert.ok(config.satelliteBasemapProviders[0].url.includes('World_Imagery'))
  assert.equal(config.satelliteBasemapProviders[0].token, '')
  assert.equal(config.minZoom, 11)
  assert.equal(config.maxZoom, 20)
})

test('basemap provider slots can be disabled and configured at runtime', () => {
  const config = resolveLeafletMapConfig({
    runtimeConfig: {
      MAP_PRIMARY_TILE_URL: 'none',
      MAP_FALLBACK_1_TILE_URL: 'https://tiles.example.test/{z}/{x}/{y}.png',
      MAP_FALLBACK_1_ATTRIBUTION: 'Example tiles',
      MAP_FALLBACK_1_TOKEN: 'runtime-token',
      MAP_FALLBACK_1_MAX_NATIVE_ZOOM: '18',
      MAP_BASEMAP_TIMEOUT_MS: '2500',
    },
    environment: {},
  })

  assert.deepEqual(
    config.basemapProviders.map(({ id }) => id),
    ['carto-voyager', 'openstreetmap-standard'],
  )
  assert.equal(
    config.basemapProviders[0].url,
    'https://tiles.example.test/{z}/{x}/{y}.png',
  )
  assert.equal(config.basemapProviders[0].attribution, 'Example tiles')
  assert.equal(config.basemapProviders[0].token, 'runtime-token')
  assert.equal(config.basemapProviders[0].maxNativeZoom, 18)
  assert.equal(config.basemapTimeoutMs, 2500)
})

test('Leaflet boundary conversion changes lng-lat to lat-lng without mutating source', () => {
  const source = [110.4351, -6.9562, 18]
  const before = structuredClone(source)
  assert.deepEqual(toLeafletLatLng(source), [-6.9562, 110.4351, 18])
  assert.deepEqual(source, before)
})

test('Point, LineString, and Polygon coordinates remain geographic', () => {
  assert.deepEqual(geometryToLeafletLatLngs({
    geometryType: 'point',
    coordinates: [110.4, -6.9],
  }), [-6.9, 110.4])
  assert.deepEqual(geometryToLeafletLatLngs({
    geometryType: 'line_string',
    coordinates: [[110.4, -6.9], [110.5, -7]],
  }), [[-6.9, 110.4], [-7, 110.5]])
  assert.deepEqual(geometryToLeafletLatLngs({
    geometryType: 'polygon',
    coordinates: [[[110.4, -6.9], [110.5, -6.9], [110.4, -7]]],
  }), [[[-6.9, 110.4], [-6.9, 110.5], [-7, 110.4]]])
})

test('MultiGeometry creates render parts while retaining one owner and immutable source', () => {
  const geometry = {
    id: 'geometry:multi-1',
    assetId: 'ASSET-01',
    sourceNodeId: 'node-01',
    geometryType: 'multi_geometry',
    coordinates: [{
      geometryType: 'line_string',
      coordinates: [[110.4, -6.9], [110.5, -7]],
    }, {
      geometryType: 'polygon',
      coordinates: [[
        [110.4, -6.9],
        [110.5, -6.9],
        [110.4, -7],
      ]],
    }],
  }
  const before = structuredClone(geometry)
  const parts = expandLeafletGeometryParts(geometry)

  assert.equal(parts.length, 2)
  assert.deepEqual(parts.map(({ geometryType }) => geometryType), [
    'line_string',
    'polygon',
  ])
  assert.ok(parts.every(({ assetId }) => assetId === 'ASSET-01'))
  assert.ok(parts.every(({ sourceGeometryId }) => sourceGeometryId === geometry.id))
  assert.deepEqual(geometry, before)
})

test('trace bounds include normalized path geometry from the shared TopologyGraph', () => {
  const positions = collectTraceGeographicPositions({
    assets: [{
      id: 'CCTV-01',
      coordinate: [110.4, -6.9],
    }, {
      id: 'SW-01',
      coordinate: [110.6, -7.1],
    }],
    geometries: [{
      id: 'geometry:path:part:1',
      sourceGeometryId: 'geometry:path',
      geometryType: 'line_string',
      coordinates: [[110.4, -6.9], [110.45, -6.82], [110.6, -7.1]],
    }],
    topologyGraph: {
      edges: [{
        id: 'edge:01',
        sourceNodeId: 'CCTV-01',
        targetNodeId: 'SW-01',
        sourceGeometryId: 'geometry:path',
      }],
    },
    traceNodeIds: ['CCTV-01', 'SW-01'],
    traceRelationIds: ['edge:01'],
  })

  assert.deepEqual(positions, [
    [110.4, -6.9],
    [110.6, -7.1],
    [110.4, -6.9],
    [110.45, -6.82],
    [110.6, -7.1],
  ])
})

test('Leaflet relation layers prioritize the shared TopologyGraph', () => {
  const topologyEdge = {
    id: 'edge:topology',
    sourceNodeId: 'CCTV-01',
    targetNodeId: 'SW-01',
    networkId: 'network:cctv',
  }
  const result = leafletMapLayerInternals.collectTopologyRelations({
    edges: [topologyEdge],
  }, [{
    id: 'network:cctv',
    relations: [{
      id: 'edge:legacy',
      sourceAssetId: 'CCTV-01',
      targetAssetId: 'SW-OLD',
    }],
  }])

  assert.equal(result.length, 1)
  assert.equal(result[0].id, topologyEdge.id)
  assert.equal(result[0].sourceAssetId, 'CCTV-01')
  assert.equal(result[0].targetAssetId, 'SW-01')
})

test('dataset bounds include assets and line-only geometry', () => {
  const positions = collectGeographicPositions(
    [{ coordinate: [110.4, -6.9] }],
    [{
      geometryType: 'line_string',
      coordinates: [[110.3, -7], [110.6, -6.8]],
    }],
  )
  assert.deepEqual(positions, [
    [110.4, -6.9],
    [110.3, -7],
    [110.6, -6.8],
  ])
})

test('Leaflet viewport output preserves the existing geographic bounds contract', () => {
  const result = leafletBoundsToGeographic({
    isValid: () => true,
    getWest: () => 110.3,
    getEast: () => 110.6,
    getSouth: () => -7,
    getNorth: () => -6.8,
  })
  assert.deepEqual(result, {
    minLng: 110.3,
    minLat: -7,
    maxLng: 110.6,
    maxLat: -6.8,
    west: 110.3,
    east: 110.6,
    south: -7,
    north: -6.8,
    corners: [
      [110.3, -6.8],
      [110.6, -6.8],
      [110.6, -7],
      [110.3, -7],
    ],
  })
})

test('network visibility and zoom tiers retain selected and tracing semantics', () => {
  const baseState = {
    selectedNetworkIds: new Set(['network:cctv']),
    highlightedNetworkId: null,
    dimOthers: true,
    traceNodeIds: [],
    connectedNodeIds: [],
  }
  assert.equal(isNetworkVisible(['network:cctv'], baseState), true)
  assert.equal(isNetworkVisible(['network:lan'], baseState), false)
  assert.equal(isNetworkVisible(['network:lan'], {
    ...baseState,
    traceNodeIds: ['SW-01'],
    assetId: 'SW-01',
  }), true)
  assert.equal(leafletZoomTier(12), 'low')
  assert.equal(leafletZoomTier(15), 'medium')
  assert.equal(leafletZoomTier(18), 'high')
})

test('map surface exposes a Leaflet host without a geographic Canvas element', () => {
  const context = {
    version: 'v2.4.0',
    branchName: 'Pengapon',
    siteScopeName: 'Pengapon',
  }
  const html = renderNetworkMapSurface(context)
  assert.match(html, /class="network-map-host"/)
  assert.doesNotMatch(html, /<canvas id="network-map"/)
  assert.doesNotMatch(html, /map-asset-tooltip/)
})

test('map page uses Leaflet directly and the geographic Canvas implementation is removed', async () => {
  const [mapPage, mapLayers, schematicSvg, schematicExport] = await Promise.all([
    readFile(new URL('../src/pages/map/map-page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/map/leaflet-map-layers.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/map/schematic-svg.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/map/schematic-export.js', import.meta.url), 'utf8'),
  ])
  assert.match(mapPage, /createLeafletMapRenderer/)
  assert.doesNotMatch(mapPage, /createMapCanvas/)
  assert.doesNotMatch(mapPage, /MAP_RENDERER|mapRenderer=canvas/)
  assert.match(mapLayers, /leaflet\.svg/)
  assert.doesNotMatch(mapLayers, /leaflet\.canvas/)
  assert.match(schematicSvg, /renderSchematicSvg/)
  assert.match(schematicExport, /downloadSchematicPng/)
  await assert.rejects(access(
    new URL('../src/pages/map/map-canvas.js', import.meta.url),
  ))
  await assert.rejects(access(
    new URL('../src/pages/map/geographic-map-renderer.js', import.meta.url),
  ))
})

test('Leaflet renderer owns geographic viewport and trace fit behavior', async () => {
  const renderer = await readFile(
    new URL('../src/pages/map/leaflet-map-renderer.js', import.meta.url),
    'utf8',
  )
  const page = await readFile(
    new URL('../src/pages/map/map-page.js', import.meta.url),
    'utf8',
  )
  assert.match(renderer, /map\.getBounds\(\)/)
  assert.match(renderer, /focusNetworkBounds/)
  assert.match(renderer, /focusTraceBounds/)
  assert.match(renderer, /panToAsset/)
  assert.match(renderer, /invalidateSize/)
  assert.match(renderer, /ResizeObserver/)
  assert.match(renderer, /fitAll/)
  assert.match(renderer, /reset/)
  assert.match(page, /topologyGraph,/)
  assert.match(page, /mapRendererApi\.focusTraceBounds/)
  assert.match(page, /siteScopeId/)
  assert.match(page, /selectedNetworkIds/)
  assert.match(page, /selectedAssetId/)
  assert.match(page, /popstate/)
  assert.doesNotMatch(page, /normalized Canvas bounds/i)
})
