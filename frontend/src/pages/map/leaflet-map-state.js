const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
const DEFAULT_BASEMAPS = Object.freeze([
  Object.freeze({
    id: 'carto-positron',
    name: 'CARTO Positron',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    subdomains: 'abcd',
    maxNativeZoom: 20,
  }),
  Object.freeze({
    id: 'carto-voyager',
    name: 'CARTO Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
    subdomains: 'abcd',
    maxNativeZoom: 20,
  }),
  Object.freeze({
    id: 'openstreetmap-standard',
    name: 'OpenStreetMap Standard',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    subdomains: '',
    maxNativeZoom: 19,
  }),
])
const DEFAULT_SATELLITE_BASEMAPS = Object.freeze([
  Object.freeze({
    id: 'esri-world-imagery',
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: ESRI_ATTRIBUTION,
    subdomains: '',
    maxNativeZoom: 19,
  }),
])

export function resolveLeafletMapConfig({
  runtimeConfig = globalThis.window?.SINERGI_CONFIG
    ?? globalThis.window?.__SINERGI_CONFIG__,
  environment = import.meta.env,
} = {}) {
  const minZoom = readNumber(
    runtimeConfig?.MAP_MIN_ZOOM ?? environment?.VITE_MAP_MIN_ZOOM,
    10,
  )
  const maxZoom = Math.max(
    minZoom,
    readNumber(runtimeConfig?.MAP_MAX_ZOOM ?? environment?.VITE_MAP_MAX_ZOOM, 22),
  )
  const maxNativeZoom = Math.min(
    maxZoom,
    readNumber(
      runtimeConfig?.MAP_MAX_NATIVE_ZOOM ?? environment?.VITE_MAP_MAX_NATIVE_ZOOM,
      19,
    ),
  )

  const basemapProviders = DEFAULT_BASEMAPS.map((fallback, index) => {
    const slot = index === 0 ? 'PRIMARY' : `FALLBACK_${index}`
    const legacyPrimaryUrl = index === 0
      ? runtimeConfig?.MAP_TILE_URL ?? environment?.VITE_MAP_TILE_URL
      : undefined
    const url = readBasemapValue({
      runtimeConfig,
      environment,
      runtimeKey: `MAP_${slot}_TILE_URL`,
      environmentKey: `VITE_MAP_${slot}_TILE_URL`,
      fallback: legacyPrimaryUrl ?? fallback.url,
    })
    if (isDisabledBasemapValue(url)) return null
    const attribution = readBasemapValue({
      runtimeConfig,
      environment,
      runtimeKey: `MAP_${slot}_ATTRIBUTION`,
      environmentKey: `VITE_MAP_${slot}_ATTRIBUTION`,
      fallback: index === 0
        ? runtimeConfig?.MAP_TILE_ATTRIBUTION
          ?? environment?.VITE_MAP_TILE_ATTRIBUTION
          ?? fallback.attribution
        : fallback.attribution,
    })
    const subdomains = readBasemapValue({
      runtimeConfig,
      environment,
      runtimeKey: `MAP_${slot}_SUBDOMAINS`,
      environmentKey: `VITE_MAP_${slot}_SUBDOMAINS`,
      fallback: index === 0
        ? runtimeConfig?.MAP_TILE_SUBDOMAINS
          ?? environment?.VITE_MAP_TILE_SUBDOMAINS
          ?? fallback.subdomains
        : fallback.subdomains,
    })
    const token = readBasemapValue({
      runtimeConfig,
      environment,
      runtimeKey: `MAP_${slot}_TOKEN`,
      environmentKey: `VITE_MAP_${slot}_TOKEN`,
      fallback: '',
    })
    return {
      id: fallback.id,
      name: fallback.name,
      url,
      attribution,
      subdomains,
      token,
      maxNativeZoom: Math.min(
        maxZoom,
        readNumber(
          runtimeConfig?.[`MAP_${slot}_MAX_NATIVE_ZOOM`]
            ?? environment?.[`VITE_MAP_${slot}_MAX_NATIVE_ZOOM`],
          fallback.maxNativeZoom,
        ),
      ),
    }
  }).filter(Boolean)
  const satelliteBasemapProviders = DEFAULT_SATELLITE_BASEMAPS
    .map((fallback) => {
      const url = readBasemapValue({
        runtimeConfig,
        environment,
        runtimeKey: 'MAP_SATELLITE_TILE_URL',
        environmentKey: 'VITE_MAP_SATELLITE_TILE_URL',
        fallback: fallback.url,
      })
      if (isDisabledBasemapValue(url)) return null
      return {
        ...fallback,
        url,
        attribution: readBasemapValue({
          runtimeConfig,
          environment,
          runtimeKey: 'MAP_SATELLITE_ATTRIBUTION',
          environmentKey: 'VITE_MAP_SATELLITE_ATTRIBUTION',
          fallback: fallback.attribution,
        }),
        token: readBasemapValue({
          runtimeConfig,
          environment,
          runtimeKey: 'MAP_SATELLITE_TOKEN',
          environmentKey: 'VITE_MAP_SATELLITE_TOKEN',
          fallback: '',
        }),
        maxNativeZoom: Math.min(maxZoom, readNumber(
          runtimeConfig?.MAP_SATELLITE_MAX_NATIVE_ZOOM
            ?? environment?.VITE_MAP_SATELLITE_MAX_NATIVE_ZOOM,
          fallback.maxNativeZoom,
        )),
      }
    })
    .filter(Boolean)

  return {
    basemapProviders,
    satelliteBasemapProviders,
    basemapTimeoutMs: Math.max(1500, readNumber(
      runtimeConfig?.MAP_BASEMAP_TIMEOUT_MS
        ?? environment?.VITE_MAP_BASEMAP_TIMEOUT_MS,
      8000,
    )),
    minZoom,
    maxZoom,
    maxNativeZoom,
    fitMaxZoom: Math.min(
      maxZoom,
      readNumber(
        runtimeConfig?.MAP_FIT_MAX_ZOOM ?? environment?.VITE_MAP_FIT_MAX_ZOOM,
        19,
      ),
    ),
    lowZoomMaxOverride: readOptionalNumber(
      runtimeConfig?.MAP_LOW_ZOOM_MAX ?? environment?.VITE_MAP_LOW_ZOOM_MAX,
    ),
    highZoomMinOverride: readOptionalNumber(
      runtimeConfig?.MAP_HIGH_ZOOM_MIN ?? environment?.VITE_MAP_HIGH_ZOOM_MIN,
    ),
    lowZoomOffset: readNumber(
      runtimeConfig?.MAP_LOW_ZOOM_OFFSET ?? environment?.VITE_MAP_LOW_ZOOM_OFFSET,
      0,
    ),
    highZoomOffset: readNumber(
      runtimeConfig?.MAP_HIGH_ZOOM_OFFSET ?? environment?.VITE_MAP_HIGH_ZOOM_OFFSET,
      3,
    ),
  }
}

export function toLeafletLatLng(position) {
  if (!isGeographicPosition(position)) return null
  const altitude = Number(position[2])
  return Number.isFinite(altitude)
    ? [Number(position[1]), Number(position[0]), altitude]
    : [Number(position[1]), Number(position[0])]
}

export function geometryToLeafletLatLngs(geometry) {
  if (!geometry) return null
  if (geometry.geometryType === 'point') return toLeafletLatLng(geometry.coordinates)
  if (geometry.geometryType === 'line_string') {
    return (geometry.coordinates ?? []).map(toLeafletLatLng).filter(Boolean)
  }
  if (geometry.geometryType === 'polygon') {
    return (geometry.coordinates ?? [])
      .map((ring) => ring.map(toLeafletLatLng).filter(Boolean))
      .filter((ring) => ring.length >= 3)
  }
  if (geometry.geometryType === 'multi_geometry') {
    return (geometry.coordinates ?? []).map(geometryToLeafletLatLngs).filter(Boolean)
  }
  return null
}

/**
 * MultiGeometry remains one source/owner record, but Leaflet needs one layer
 * per drawable child. The returned parts are render-only clones and never
 * replace the normalized source geometry.
 */
export function expandLeafletGeometryParts(geometry) {
  if (!geometry || typeof geometry !== 'object') return []
  if (geometry.geometryType !== 'multi_geometry') return [geometry]

  const sourceGeometryId = geometry.sourceGeometryId || geometry.id
  return (geometry.coordinates ?? []).flatMap((child, index) => {
    if (!child || typeof child !== 'object') return []
    const inherited = {
      ...geometry,
      id: `${geometry.id}:part:${index + 1}`,
      sourceGeometryId,
      geometryPartIndex: index,
      geometryType: child.geometryType,
      coordinates: structuredClone(child.coordinates),
    }
    delete inherited.displayCoordinates
    return child.geometryType === 'multi_geometry'
      ? expandLeafletGeometryParts(inherited)
      : [inherited]
  })
}

export function collectGeographicPositions(assets = [], geometries = []) {
  const positions = []
  assets.forEach((asset) => {
    if (isGeographicPosition(asset.coordinate)) positions.push(asset.coordinate)
  })
  geometries.forEach((geometry) => collectGeometryPositions(geometry, positions))
  return positions.map((position) => structuredClone(position))
}

export function collectTraceGeographicPositions({
  assets = [],
  geometries = [],
  topologyGraph = null,
  traceNodeIds = [],
  traceRelationIds = [],
} = {}) {
  const positions = []
  const nodeIds = new Set(traceNodeIds)
  const geometryIds = collectTraceGeometryIds({
    topologyGraph,
    traceNodeIds,
    traceRelationIds,
  })

  assets.forEach((asset) => {
    if (nodeIds.has(asset.id) && isGeographicPosition(asset.coordinate)) {
      positions.push(asset.coordinate)
    }
  })

  geometries.forEach((geometry) => {
    const sourceId = geometry.sourceGeometryId || geometry.id
    if (!geometryIds.has(geometry.id) && !geometryIds.has(sourceId)) return
    collectGeometryPositions(geometry, positions)
  })

  return positions.map((position) => structuredClone(position))
}

export function collectTraceGeometryIds({
  topologyGraph = null,
  traceNodeIds = [],
  traceRelationIds = [],
} = {}) {
  const relationIds = new Set(traceRelationIds)
  const tracePairs = new Set(traceNodeIds.slice(1).map((nodeId, index) => (
    [traceNodeIds[index], nodeId].sort().join('|')
  )))
  const geometryIds = new Set()
  ;(topologyGraph?.edges ?? []).forEach((edge) => {
    const sourceNodeId = edge.sourceNodeId || edge.sourceAssetId
    const targetNodeId = edge.targetNodeId || edge.targetAssetId
    const pair = [sourceNodeId, targetNodeId].sort().join('|')
    if (!relationIds.has(edge.id) && !tracePairs.has(pair)) return
    ;[
      edge.pathGeometryId,
      edge.sourceGeometryId,
      ...(edge.sourceGeometryIds ?? []),
    ].filter(Boolean).forEach((geometryId) => geometryIds.add(geometryId))
  })
  return geometryIds
}

export function positionsToLeafletBounds(leaflet, positions) {
  const latLngs = (positions ?? []).map(toLeafletLatLng).filter(Boolean)
  if (!latLngs.length) return null
  return leaflet.latLngBounds(latLngs)
}

export function networkToLeafletBounds(leaflet, network, {
  assetsById,
  geometriesById,
} = {}) {
  if (Array.isArray(network?.bounds)
    && network.bounds.length >= 4
    && network.bounds.every(Number.isFinite)) {
    const [west, south, east, north] = network.bounds
    return leaflet.latLngBounds([south, west], [north, east])
  }
  const positions = []
  ;(network?.nodeIds ?? []).forEach((assetId) => {
    const coordinate = assetsById?.get(assetId)?.coordinate
    if (isGeographicPosition(coordinate)) positions.push(coordinate)
  })
  ;(network?.geometryIds ?? []).forEach((geometryId) => {
    const geometry = geometriesById?.get(geometryId)
    if (geometry) collectGeometryPositions(geometry, positions)
  })
  return positionsToLeafletBounds(leaflet, positions)
}

export function leafletBoundsToGeographic(bounds) {
  if (!bounds?.isValid?.()) return null
  const west = bounds.getWest()
  const east = bounds.getEast()
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  return {
    minLng: west,
    minLat: south,
    maxLng: east,
    maxLat: north,
    west,
    east,
    south,
    north,
    corners: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  }
}

export function leafletZoomTier(zoom, {
  lowZoomMax = 13,
  highZoomMin = 17,
} = {}) {
  if (zoom <= lowZoomMax) return 'low'
  if (zoom >= highZoomMin) return 'high'
  return 'medium'
}

export function deriveLeafletZoomThresholds(fitZoom, {
  minZoom = 0,
  maxZoom = 22,
  lowZoomMaxOverride = null,
  highZoomMinOverride = null,
  lowZoomOffset = 0,
  highZoomOffset = 3,
} = {}) {
  const normalizedFitZoom = clampNumber(
    Math.round(Number(fitZoom)),
    minZoom,
    maxZoom,
  )
  const lowZoomMax = clampNumber(
    Number.isFinite(lowZoomMaxOverride)
      ? lowZoomMaxOverride
      : normalizedFitZoom + lowZoomOffset,
    minZoom,
    Math.max(minZoom, maxZoom - 1),
  )
  const highZoomMin = clampNumber(
    Number.isFinite(highZoomMinOverride)
      ? highZoomMinOverride
      : normalizedFitZoom + highZoomOffset,
    Math.min(maxZoom, lowZoomMax + 1),
    maxZoom,
  )
  return {
    fitZoom: normalizedFitZoom,
    lowZoomMax,
    highZoomMin,
  }
}

export function isNetworkVisible(networkIds, {
  selectedNetworkIds,
  highlightedNetworkId,
  dimOthers,
  traceNodeIds = [],
  connectedNodeIds = [],
  assetId = null,
} = {}) {
  if (!dimOthers) return true
  if ((networkIds ?? []).some((networkId) => selectedNetworkIds?.has(networkId))) return true
  if ((networkIds ?? []).includes(highlightedNetworkId)) return true
  if (assetId && (traceNodeIds.includes(assetId) || connectedNodeIds.includes(assetId))) return true
  return false
}

function collectGeometryPositions(geometry, output) {
  if (!geometry) return
  if (geometry.geometryType === 'point') {
    if (isGeographicPosition(geometry.coordinates)) output.push(geometry.coordinates)
    return
  }
  if (geometry.geometryType === 'line_string') {
    ;(geometry.coordinates ?? []).forEach((position) => {
      if (isGeographicPosition(position)) output.push(position)
    })
    return
  }
  if (geometry.geometryType === 'polygon') {
    ;(geometry.coordinates ?? []).flat().forEach((position) => {
      if (isGeographicPosition(position)) output.push(position)
    })
    return
  }
  if (geometry.geometryType === 'multi_geometry') {
    ;(geometry.coordinates ?? []).forEach((child) => collectGeometryPositions(child, output))
  }
}

function isGeographicPosition(value) {
  if (!Array.isArray(value) || value.length < 2) return false
  const longitude = Number(value[0])
  const latitude = Number(value[1])
  return Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
}

function readNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function readBasemapValue({
  runtimeConfig,
  environment,
  runtimeKey,
  environmentKey,
  fallback,
}) {
  return String(
    runtimeConfig?.[runtimeKey]
      ?? environment?.[environmentKey]
      ?? fallback
      ?? '',
  ).trim()
}

function isDisabledBasemapValue(value) {
  return ['none', 'off', 'disabled']
    .includes(String(value).trim().toLowerCase())
}

function readOptionalNumber(value) {
  if (value == null || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampNumber(value, minimum, maximum) {
  const number = Number.isFinite(Number(value)) ? Number(value) : minimum
  return Math.min(maximum, Math.max(minimum, number))
}

export const leafletMapStateInternals = {
  CARTO_ATTRIBUTION,
  OSM_ATTRIBUTION,
  ESRI_ATTRIBUTION,
  DEFAULT_BASEMAPS,
  DEFAULT_SATELLITE_BASEMAPS,
  isGeographicPosition,
}
