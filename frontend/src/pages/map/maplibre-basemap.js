// Must remain longer than the backend's complete upstream retry window.
// A slow but successful tile must not be reported as an unavailable basemap.
export const BASEMAP_LOAD_TIMEOUT_MS = 25_000
export const BASEMAP_RETRY_DELAYS_MS = Object.freeze([600, 1_800])

export function createBaseStyle({
  imageryTiles,
  imageryMaxZoom = 18,
  vectorTiles,
  attribution,
}) {
  const sources = {}
  const layers = [{
    id: 'safe-background',
    type: 'background',
    paint: { 'background-color': '#f7f6f1' },
  }]
  if (imageryTiles) {
    sources['satellite-imagery'] = {
      type: 'raster',
      tiles: [imageryTiles],
      tileSize: 256,
      maxzoom: imageryMaxZoom,
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
        'raster-saturation': -0.08,
        'raster-contrast': 0.12,
        'raster-brightness-min': 0.08,
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
            'wood', '#e4eee0',
            'grass', '#eaf1e3',
            '#f1f2eb',
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
            'residential', '#f7f5ef',
            'industrial', '#f2efe7',
            'commercial', '#f5f1e9',
            'park', '#e8f1e2',
            'cemetery', '#e8eee1',
            'school', '#f5f0e6',
            'hospital', '#f5eeeb',
            '#f6f4ee',
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
          'line-color': '#aaa9a3',
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
        paint: { 'fill-color': '#a9dff0', 'fill-opacity': 1 },
      },
      {
        id: 'basemap-building-shadows',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-color': '#777a78',
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
            14, '#eeece6',
            17, '#e1e0da',
            20, '#d8d8d2',
          ],
          'fill-outline-color': '#bfc1be',
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
          'text-color': '#62635f',
          'text-halo-color': '#fbfaf6',
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
          'line-color': '#96d4e8',
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
            'motorway', '#a8abad',
            'trunk', '#afb2b2',
            'primary', '#babbb9',
            'secondary', '#cacbc7',
            'tertiary', '#d2d2cd',
            'minor', '#d9d8d2',
            'service', '#ddddd7',
            'path', '#deddd6',
            'track', '#d8d6ce',
            '#d9d8d2',
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
            'motorway', '#d0d2d2',
            'trunk', '#d5d6d5',
            'primary', '#dcddda',
            'secondary', '#eeede8',
            'tertiary', '#f6f4ee',
            'minor', '#fbfaf6',
            'service', '#fbfaf6',
            'path', '#f0eee7',
            'track', '#ebe8de',
            '#faf9f5',
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
          'line-color': '#8e9292',
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
          'text-color': '#5e605e',
          'text-halo-color': '#fbfaf6',
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
          'text-color': '#696b68',
          'text-halo-color': '#fbfaf6',
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
          'text-color': '#686a67',
          'text-halo-color': '#fbfaf6',
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
          'text-color': '#7d7e7a',
          'text-halo-color': '#fbfaf6',
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
