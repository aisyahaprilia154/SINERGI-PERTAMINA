// Must remain longer than the backend's complete upstream retry window.
// A slow but successful tile must not be reported as an unavailable basemap.
export const BASEMAP_LOAD_TIMEOUT_MS = 25_000
export const BASEMAP_RETRY_DELAYS_MS = Object.freeze([600, 1_800])
// ArcGIS World Imagery returns a placeholder tile above this level for many
// locations. Keeping the map zoomable beyond it lets MapLibre overzoom the
// last real image instead of showing the provider's "not yet available" tile.
export const DEFAULT_IMAGERY_MAX_ZOOM = 18

function basemapPalette(darkMode) {
  if (!darkMode) return {
    background: '#f7f6f1',
    landcover: ['#e4eee0', '#eaf1e3', '#f1f2eb'],
    landuse: ['#f7f5ef', '#f2efe7', '#f5f1e9', '#e8f1e2', '#e8eee1', '#f5f0e6', '#f5eeeb', '#f6f4ee'],
    boundary: '#aaa9a3',
    water: '#a9dff0',
    buildingShadow: '#777a78',
    buildings: ['#eeece6', '#e1e0da', '#d8d8d2'],
    buildingOutline: '#bfc1be',
    label: '#62635f',
    labelSecondary: '#696b68',
    labelMuted: '#7d7e7a',
    labelHalo: '#fbfaf6',
    waterway: '#96d4e8',
    roadCasing: ['#a8abad', '#afb2b2', '#babbb9', '#cacbc7', '#d2d2cd', '#d9d8d2', '#ddddd7', '#deddd6', '#d8d6ce', '#d9d8d2'],
    roads: ['#d0d2d2', '#d5d6d5', '#dcddda', '#eeede8', '#f6f4ee', '#fbfaf6', '#fbfaf6', '#f0eee7', '#ebe8de', '#faf9f5'],
    rail: '#8e9292',
  }
  return {
    background: '#171719',
    landcover: ['#243027', '#283229', '#202225'],
    landuse: ['#242426', '#292827', '#282528', '#202b23', '#252b26', '#292722', '#2b2425', '#232326'],
    boundary: '#6b6b72',
    water: '#173b4d',
    buildingShadow: '#09090a',
    buildings: ['#29292c', '#323236', '#3a3a3f'],
    buildingOutline: '#5b5b62',
    label: '#e5e5ea',
    labelSecondary: '#d1d1d6',
    labelMuted: '#b8b8be',
    labelHalo: '#171719',
    waterway: '#3f8cad',
    roadCasing: ['#151517', '#171719', '#19191b', '#1b1b1d', '#1d1d1f', '#1f1f21', '#202022', '#202022', '#1e1e20', '#1f1f21'],
    roads: ['#4a4a50', '#48484e', '#46464c', '#424248', '#3e3e44', '#39393f', '#39393f', '#35353a', '#323237', '#37373c'],
    rail: '#77777e',
  }
}

export function createBaseStyle({
  imageryTiles,
  vectorTiles,
  attribution,
  imageryMaxZoom = DEFAULT_IMAGERY_MAX_ZOOM,
  darkMode = false,
}) {
  const palette = basemapPalette(darkMode)
  const sources = {}
  const layers = [{
    id: 'safe-background',
    type: 'background',
    paint: { 'background-color': palette.background },
  }]
  if (imageryTiles) {
    const sourceMaxZoom = Number.isFinite(Number(imageryMaxZoom))
      ? Math.min(22, Math.max(0, Number(imageryMaxZoom)))
      : DEFAULT_IMAGERY_MAX_ZOOM
    sources['satellite-imagery'] = {
      type: 'raster',
      tiles: [imageryTiles],
      tileSize: 256,
      maxzoom: sourceMaxZoom,
      ...(attribution ? { attribution } : {}),
    }
    layers.push({
      id: 'satellite-imagery',
      type: 'raster',
      source: 'satellite-imagery',
      layout: {
        visibility: vectorTiles ? 'none' : 'visible',
      },
      paint: {
        'raster-opacity': 1,
        'raster-saturation': darkMode ? -0.34 : -0.08,
        'raster-contrast': darkMode ? 0.18 : 0.12,
        'raster-brightness-min': darkMode ? 0.02 : 0.08,
        'raster-brightness-max': darkMode ? 0.58 : 1,
      },
    })
  }
  if (vectorTiles) {
    sources.openfreemap = {
      type: 'vector',
      url: vectorTiles,
      attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    }
    layers.push(
      {
        id: 'basemap-landcover',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'wood', palette.landcover[0],
            'grass', palette.landcover[1],
            palette.landcover[2],
          ],
          'fill-opacity': 0.82,
        },
      },
      {
        id: 'basemap-landuse',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landuse',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'residential', palette.landuse[0],
            'industrial', palette.landuse[1],
            'commercial', palette.landuse[2],
            'park', palette.landuse[3],
            'cemetery', palette.landuse[4],
            'school', palette.landuse[5],
            'hospital', palette.landuse[6],
            palette.landuse[7],
          ],
          'fill-opacity': 0.9,
        },
      },
      {
        id: 'basemap-boundaries',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'boundary',
        minzoom: 7,
        filter: ['in', ['get', 'admin_level'], ['literal', [2, 4, 6]]],
        paint: {
          'line-color': palette.boundary,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            7, 0.45,
            15, 1,
          ],
          'line-dasharray': [3, 2],
          'line-opacity': 0.42,
        },
      },
      {
        id: 'basemap-water',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'water',
        paint: { 'fill-color': palette.water, 'fill-opacity': 1 },
      },
      {
        id: 'basemap-building-shadows',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-color': palette.buildingShadow,
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            14, 0.08,
            17, 0.16,
          ],
          'fill-translate': [1, 1],
          'fill-translate-anchor': 'viewport',
        },
      },
      {
        id: 'basemap-buildings',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['zoom'],
            14, palette.buildings[0],
            17, palette.buildings[1],
            20, palette.buildings[2],
          ],
          'fill-outline-color': palette.buildingOutline,
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            14, 0.78,
            17, 0.96,
          ],
        },
      },
      {
        id: 'basemap-building-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 16,
        layout: {
          visibility: 'none',
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-max-width': 9,
          'text-padding': 3,
        },
        paint: {
          'text-color': palette.label,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'basemap-waterways',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'waterway',
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette.waterway,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 0.7,
            18, 3,
          ],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'basemap-road-casing',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway', palette.roadCasing[0],
            'trunk', palette.roadCasing[1],
            'primary', palette.roadCasing[2],
            'secondary', palette.roadCasing[3],
            'tertiary', palette.roadCasing[4],
            'minor', palette.roadCasing[5],
            'service', palette.roadCasing[6],
            'path', palette.roadCasing[7],
            'track', palette.roadCasing[8],
            palette.roadCasing[9],
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            7, [
              'match', ['get', 'class'],
              'motorway', 1.4,
              'trunk', 1.15,
              'primary', 0.9,
              0.35,
            ],
            13, [
              'match', ['get', 'class'],
              'motorway', 5,
              'trunk', 4.5,
              'primary', 4,
              'secondary', 3.2,
              'tertiary', 2.6,
              1.6,
            ],
            20, [
              'match', ['get', 'class'],
              'motorway', 18,
              'trunk', 17,
              'primary', 16,
              'secondary', 14,
              'tertiary', 12,
              'minor', 10,
              'service', 8,
              5,
            ],
          ],
          'line-opacity': [
            'match',
            ['get', 'class'],
            'path', 0.68,
            'track', 0.7,
            0.96,
          ],
        },
      },
      {
        id: 'basemap-roads',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 7,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway', palette.roads[0],
            'trunk', palette.roads[1],
            'primary', palette.roads[2],
            'secondary', palette.roads[3],
            'tertiary', palette.roads[4],
            'minor', palette.roads[5],
            'service', palette.roads[6],
            'path', palette.roads[7],
            'track', palette.roads[8],
            palette.roads[9],
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            7, [
              'match', ['get', 'class'],
              'motorway', 0.9,
              'trunk', 0.7,
              'primary', 0.5,
              0.2,
            ],
            13, [
              'match', ['get', 'class'],
              'motorway', 3.7,
              'trunk', 3.2,
              'primary', 2.8,
              'secondary', 2.2,
              'tertiary', 1.7,
              0.9,
            ],
            20, [
              'match', ['get', 'class'],
              'motorway', 15.5,
              'trunk', 14.5,
              'primary', 13.5,
              'secondary', 11.5,
              'tertiary', 9.5,
              'minor', 7.5,
              'service', 5.5,
              3,
            ],
          ],
          'line-opacity': 0.98,
        },
      },
      {
        id: 'basemap-railways',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['==', ['get', 'class'], 'rail'],
        paint: {
          'line-color': palette.rail,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 0.7,
            18, 2,
          ],
          'line-dasharray': [2, 2],
          'line-opacity': 0.82,
        },
      },
      {
        id: 'basemap-road-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'transportation_name',
        minzoom: 12,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 420,
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'ref']],
          'text-font': ['Noto Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            12, 9,
            17, 11,
            20, 12,
          ],
          'text-letter-spacing': 0.03,
          'text-max-angle': 35,
        },
        paint: {
          'text-color': palette.label,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.8,
        },
      },
      {
        id: 'basemap-place-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        minzoom: 12,
        maxzoom: 18,
        layout: {
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            12, 10,
            16, 12,
          ],
          'text-letter-spacing': 0.18,
          'text-transform': 'uppercase',
        },
        paint: {
          'text-color': palette.labelSecondary,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.8,
        },
      },
      {
        id: 'basemap-poi-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'poi',
        minzoom: 16,
        layout: {
          visibility: 'none',
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 0.7],
          'text-anchor': 'top',
          'text-max-width': 10,
        },
        paint: {
          'text-color': palette.labelSecondary,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.5,
        },
      },
      {
        id: 'basemap-house-numbers',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'housenumber',
        minzoom: 18,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'housenumber'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 9,
        },
        paint: {
          'text-color': palette.labelMuted,
          'text-halo-color': palette.labelHalo,
          'text-halo-width': 1.2,
        },
      },
    )
  }
  return {
    version: 8,
    glyphs: '/api/basemap/openfreemap/fonts/{fontstack}/{range}.pbf',
    sources,
    layers,
  }
}

export function applyBaseStyleTheme(map, {
  darkMode = false,
  imageryTiles = '',
  vectorTiles = '',
} = {}) {
  if (!map || typeof map.getLayer !== 'function' || typeof map.setPaintProperty !== 'function') return
  const themedStyle = createBaseStyle({
    imageryTiles,
    vectorTiles,
    attribution: '',
    darkMode,
  })
  themedStyle.layers.forEach(({ id, paint = {} }) => {
    if (!map.getLayer(id)) return
    Object.entries(paint).forEach(([property, value]) => {
      map.setPaintProperty(id, property, value)
    })
  })
}

export function isBasemapError(event) {
  const message = String(event?.error?.message ?? '')
  return event?.sourceId === 'satellite-imagery'
    || event?.sourceId === 'openfreemap'
    || event?.source?.id === 'satellite-imagery'
    || event?.source?.id === 'openfreemap'
    || message.includes('satellite-imagery')
    || message.includes('openfreemap')
    || message.includes('/api/basemap/openfreemap/')
    || message.includes('tiles.openfreemap.org')
}

export function isBasemapLoadedEvent(event, sourceId) {
  if (!sourceId || event?.sourceId !== sourceId) return false
  // MapLibre can report isSourceLoaded=true after a source-level error. A tile
  // event, on the other hand, is emitted by TileManager only after _tileLoaded.
  return Boolean(event.tile)
}

export function basemapErrorMessage(event) {
  const message = String(event?.error?.message ?? '').trim()
  return message || 'Resource basemap gagal dimuat.'
}
