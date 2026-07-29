// Must remain longer than the backend's complete upstream retry window.
// A slow but successful tile must not be reported as an unavailable basemap.
export const BASEMAP_LOAD_TIMEOUT_MS = 25_000
export const BASEMAP_RETRY_DELAYS_MS = Object.freeze([600, 1_800])

export function createBaseStyle({ imageryTiles, vectorTiles, attribution }) {
  const sources = {}
  const layers = [{
    id: 'safe-background',
    type: 'background',
    paint: { 'background-color': '#edf2f6' },
  }]
  if (imageryTiles) {
    sources['satellite-imagery'] = {
      type: 'raster',
      tiles: [imageryTiles],
      tileSize: 256,
      ...(attribution ? { attribution } : {}),
    }
    layers.push({
      id: 'satellite-imagery',
      type: 'raster',
      source: 'satellite-imagery',
      paint: {
        'raster-opacity': 1,
        'raster-saturation': -0.12,
        'raster-contrast': 0.08,
      },
    })
  } else if (vectorTiles) {
    sources.openfreemap = {
      type: 'vector',
      url: vectorTiles,
      attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    }
    layers.push(
      {
        id: 'basemap-landuse',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landuse',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'residential', '#e8edf1',
            'industrial', '#e5e8ec',
            'park', '#dcecdf',
            '#edf2f5',
          ],
          'fill-opacity': 0.96,
        },
      },
      {
        id: 'basemap-landcover',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'wood', '#d5e8da',
            'grass', '#e1ecd8',
            '#e8eef2',
          ],
          'fill-opacity': 0.88,
        },
      },
      {
        id: 'basemap-water',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'water',
        paint: { 'fill-color': '#bddff0', 'fill-opacity': 1 },
      },
      {
        id: 'basemap-buildings',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': '#d8dee4',
          'fill-outline-color': '#c2ccd5',
          'fill-opacity': 0.88,
        },
      },
      {
        id: 'basemap-road-casing',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 1.5,
            16, 6,
            20, 13,
          ],
          'line-opacity': 0.96,
        },
      },
      {
        id: 'basemap-roads',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway', '#d9ad73',
            'trunk', '#e0bd89',
            'primary', '#e7cfa8',
            'secondary', '#d4dce3',
            '#c9d3dc',
          ],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 0.7,
            16, 3.2,
            20, 8,
          ],
          'line-opacity': 0.98,
        },
      },
      {
        id: 'basemap-road-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'transportation_name',
        minzoom: 14,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 320,
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name'], ['get', 'ref']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-max-angle': 35,
        },
        paint: {
          'text-color': '#586d7e',
          'text-halo-color': '#f8fafc',
          'text-halo-width': 1.5,
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
          'text-size': 11,
          'text-transform': 'uppercase',
        },
        paint: {
          'text-color': '#40586b',
          'text-halo-color': '#f8fafc',
          'text-halo-width': 1.5,
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
