import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import {
  BASEMAP_LOAD_TIMEOUT_MS,
  createBaseStyle,
  isBasemapError,
  isBasemapLoadedEvent,
} from '../src/pages/map/maplibre-basemap.js'

test('MapLibre map class does not shadow the native Map collection', async () => {
  const source = await readFile(
    new URL('../src/pages/map/maplibre-map.js', import.meta.url),
    'utf8',
  )
  const basemapSource = await readFile(
    new URL('../src/pages/map/maplibre-basemap.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /\bMap as MapLibreMap\b/)
  assert.match(source, /\bnew MapLibreMap\(\{/)
  assert.match(source, /maplibre-gl-worker\.mjs\?worker&url/)
  assert.match(source, /\bsetWorkerUrl\(maplibreWorkerUrl\)/)
  assert.doesNotMatch(source, /\bnew Map\(\{\s*container:/)
  assert.match(basemapSource, /\/api\/basemap\/openfreemap\/fonts/)
  assert.match(basemapSource, /basemap-road-labels/)
  assert.ok(
    source.indexOf('syncSources()') < source.indexOf('addOperationalLayers(map)'),
    'GeoJSON data must be synchronized before optional operational layers are added',
  )
})

test('Vite leaves MapLibre out of dependency optimization so its worker URL stays valid', async () => {
  const { default: config } = await import('../vite.config.js')
  assert.deepEqual(config.optimizeDeps?.exclude, ['maplibre-gl'])
  assert.equal(config.server?.strictPort, true)
})

test('local runner enables satellite imagery through the same-origin backend proxy', async () => {
  const source = await readFile(new URL('../../scripts/dev.mjs', import.meta.url), 'utf8')

  assert.match(source, /SINERGI_IMAGERY_TILE_TEMPLATE/)
  assert.match(source, /\/api\/basemap\/imagery\/tiles\/\{z\}\/\{x\}\/\{y\}\.jpg/)
  assert.match(source, /VITE_SINERGI_BASEMAP_TILES: localImageryTiles/)
  assert.match(source, /VITE_SINERGI_BASEMAP_MAX_ZOOM: imageryMaxZoom/)
  assert.match(source, /VITE_SINERGI_BASEMAP_ATTRIBUTION: imageryAttribution/)
})

test('user map mounts MapLibre with area scope and never loads review candidates', async () => {
  const source = await readFile(
    new URL('../src/pages/map/map-page.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /import \{ createMapLibreSurface \} from '\.\/maplibre-map\.js'/)
  assert.match(source, /projection: 'overlays'/)
  assert.match(source, /candidates: \[\]/)
  assert.match(source, /params\.set\('area', nextArea\)/)
  assert.doesNotMatch(source, /projection: 'candidates'/)
  assert.doesNotMatch(source, /createFlatNetworkMap\(/)
})

test('connection review keeps the decision beside a candidate-focused asset map', async () => {
  const reviewSource = await readFile(
    new URL('../src/pages/admin/topology-review-page.js', import.meta.url),
    'utf8',
  )
  const mapSource = await readFile(
    new URL('../src/pages/map/maplibre-map.js', import.meta.url),
    'utf8',
  )

  assert.match(reviewSource, /id="review-map"/)
  assert.match(reviewSource, /createMapLibreSurface\(container\.querySelector\('#review-map'\)/)
  assert.match(reviewSource, /candidates: initialLocationCandidates/)
  assert.match(reviewSource, /reviewMap\.focusCoordinates\(positions\)/)
  assert.match(reviewSource, /class="site-select"/)
  assert.match(reviewSource, /mapData\.locationGroups\.map/)
  assert.match(reviewSource, /scopeMapData\(\{/)
  assert.match(reviewSource, /query\.set\('area', nextArea\)/)
  assert.match(reviewSource, /attachCandidateMapGeometryIds/)
  assert.match(reviewSource, /isolateSelectedCandidate: false/)
  assert.doesNotMatch(reviewSource, /loadImportConfig/)
  assert.match(reviewSource, /class="decision-reason-select"/)
  assert.match(reviewSource, /Detail tambahan <small>Opsional/)
  assert.match(reviewSource, /decisionDialogCopy/)
  assert.doesNotMatch(reviewSource, /class="review-reason"/)
  assert.match(mapSource, /selectedCandidateId/)
  assert.match(mapSource, /selectedCandidateGeometryIds/)
  assert.match(mapSource, /selectedCandidateFocus/)
  assert.match(mapSource, /candidateContextDimmed/)
  assert.match(mapSource, /candidateFocused/)
  assert.match(mapSource, /candidateContextDimmed\s*\?\s*0\.16/)
  assert.match(mapSource, /focusCoordinates\(positions\)/)
  assert.match(mapSource, /map-selected-candidate-overlay/)
  assert.match(mapSource, /Koneksi dipilih/)
  assert.match(mapSource, /selected-map-endpoint source/)
  assert.match(mapSource, /selected-map-endpoint target/)
  assert.match(mapSource, /function geometryIdsForCandidate/)
  assert.match(mapSource, /!isolateCandidate \|\| trace/)
  assert.match(mapSource, /!isolateCandidate \|\| candidate\.candidateId === state\.selectedCandidateId/)
})

test('MapLibre basemap is environment-configured and operational data is fail-safe', async () => {
  const source = await readFile(
    new URL('../src/pages/map/maplibre-map.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /VITE_SINERGI_BASEMAP_TILES/)
  assert.match(source, /VITE_SINERGI_BASEMAP_MAX_ZOOM/)
  assert.match(source, /VITE_SINERGI_VECTOR_TILES_URL/)
  assert.match(source, /\/api\/basemap\/openfreemap\/planet/)
  assert.doesNotMatch(source, /services\.arcgisonline\.com/)
  assert.match(source, /map\.on\('error'/)
  assert.match(source, /setBasemapStatus\('unavailable'\)/)
  assert.match(source, /map\.on\('style\.load', initializeOperationalLayers\)/)
  assert.doesNotMatch(source, /map\.on\('load', initializeOperationalLayers\)/)
  assert.match(source, /BASEMAP_LOAD_TIMEOUT_MS/)
  assert.match(source, /buildAdaptiveAssetLayout/)
  assert.match(source, /map\.on\('move', scheduleAdaptiveMarkers\)/)
  assert.match(source, /setDeclutterEnabled\(enabled\)/)
  assert.match(source, /drawKmlLineOverlay/)
  assert.match(source, /map-kml-line-overlay/)
  assert.match(source, /cooperativeGestures: false/)
  assert.match(source, /scrollZoom: true/)
  assert.match(source, /touchZoomRotate: true/)
  assert.match(source, /touchPitch: false/)
  assert.match(source, /dragRotate: false/)
  assert.match(source, /pitchWithRotate: true/)
  assert.match(source, /map\.dragRotate\.enable\(\)/)
  assert.match(source, /map\.dragRotate\.disable\(\)/)
  assert.doesNotMatch(source, /\bnew Marker\(/)
})

test('fallback and vector basemap styles are valid and use a visible neutral canvas', () => {
  const fallbackStyle = createBaseStyle({
    imageryTiles: '',
    vectorTiles: '',
    attribution: '',
  })
  const vectorStyle = createBaseStyle({
    imageryTiles: '',
    vectorTiles: 'https://tiles.openfreemap.org/planet',
    attribution: '',
  })
  const fieldStyle = createBaseStyle({
    imageryTiles: 'https://imagery.example.test/{z}/{x}/{y}.jpg',
    imageryMaxZoom: 18,
    vectorTiles: 'https://tiles.openfreemap.org/planet',
    attribution: 'Imagery test',
  })

  assert.deepEqual(validateStyleMin(fallbackStyle), [])
  assert.deepEqual(validateStyleMin(vectorStyle), [])
  assert.deepEqual(validateStyleMin(fieldStyle), [])
  assert.equal(
    fieldStyle.layers.find(({ id }) => id === 'satellite-imagery')
      ?.layout?.visibility,
    'none',
  )
  assert.equal(fieldStyle.sources['satellite-imagery']?.maxzoom, 18)
  assert.ok(fieldStyle.layers.some(({ id }) => id === 'basemap-poi-labels'))
  assert.ok(fieldStyle.layers.some(({ id }) => id === 'basemap-house-numbers'))
  assert.equal(
    fieldStyle.layers.find(({ id }) => id === 'basemap-buildings')?.minzoom,
    14,
  )
  assert.ok(fieldStyle.layers.some(({ id }) => id === 'basemap-building-shadows'))
  assert.ok(fieldStyle.layers.some(({ id }) => id === 'basemap-building-labels'))
  assert.notEqual(
    fieldStyle.layers.find(({ id }) => id === 'basemap-buildings')
      ?.layout?.visibility,
    'none',
  )
  assert.equal(
    fieldStyle.layers.find(({ id }) => id === 'basemap-house-numbers')
      ?.layout?.visibility,
    'none',
  )
  assert.equal(
    fallbackStyle.layers.find(({ id }) => id === 'safe-background')
      ?.paint?.['background-color'],
    '#f7f6f1',
  )
  assert.equal(
    fieldStyle.layers.find(({ id }) => id === 'basemap-water')
      ?.paint?.['fill-color'],
    '#a9dff0',
  )
  assert.equal(
    fieldStyle.layers.find(({ id }) => id === 'basemap-roads')
      ?.paint?.['line-color']?.[0],
    'match',
  )
})

test('basemap errors are recognized from source ids and remote resource URLs', () => {
  assert.equal(isBasemapError({ sourceId: 'openfreemap' }), true)
  assert.equal(isBasemapError({
    error: { message: 'Failed to fetch https://tiles.openfreemap.org/planet' },
  }), true)
  assert.equal(isBasemapError({
    error: { message: 'Failed to fetch /api/basemap/openfreemap/planet' },
  }), true)
  assert.equal(isBasemapError({
    error: { message: 'Failed to fetch /api/datasets/dataset-semarang/active' },
  }), false)
})

test('one successfully loaded basemap tile is enough to report availability', () => {
  assert.equal(isBasemapLoadedEvent({
    sourceId: 'openfreemap',
    tile: { state: 'loaded' },
    isSourceLoaded: false,
  }, 'openfreemap'), true)
  assert.equal(isBasemapLoadedEvent({
    sourceId: 'openfreemap',
    sourceDataType: 'metadata',
    isSourceLoaded: false,
  }, 'openfreemap'), false)
  assert.equal(isBasemapLoadedEvent({
    sourceId: 'sinergi-points',
    tile: { state: 'loaded' },
  }, 'openfreemap'), false)
  assert.ok(
    BASEMAP_LOAD_TIMEOUT_MS > 20_000,
    'Frontend timeout must exceed both backend upstream attempts',
  )
})
