const DEFAULT_WIDTH = 1840
const MIN_HEIGHT = 980
const MAX_HEIGHT = 1640
const PADDING = 86

const FAMILY_COLORS = Object.freeze({
  cctv: '#9698f4',
  'fiber-optic': '#2fd2a8',
  lan: '#42b9ed',
  infrastructure: '#efc363',
  peripheral: '#a88af3',
  unmapped: '#94a3b8',
})

export function createSpatialTopologyLayout({
  assets = [],
  geometries = [],
  sourceFeatures = [],
  sourceGeometries = [],
  graph = {},
  candidates = [],
  unresolved = [],
  state = {},
} = {}) {
  const authoritativeGeometries = normalizeSourceGeometries(sourceGeometries)
  const mapGeometries = normalizeMapGeometries(geometries)
  const useSourceProjection = authoritativeGeometries.length > 0
  const spatialGeometries = useSourceProjection
    ? filterToMapVisibility(authoritativeGeometries, mapGeometries)
    : mapGeometries
  const featureById = new Map(sourceFeatures.map((feature) => [
    feature.sourceFeatureId,
    feature,
  ]))
  const geometryByFeatureId = groupBy(spatialGeometries, 'sourceFeatureId')
  const openCandidates = candidates.filter(({ candidateStatus }) => (
    ['candidate', 'ambiguous'].includes(candidateStatus)
  ))
  const positions = [
    ...spatialGeometries.flatMap(extractPositions),
    ...openCandidates.flatMap(({ sourceCoordinate, targetCoordinate }) => (
      [sourceCoordinate, targetCoordinate].filter(validCoordinate)
    )),
    ...unresolved.map(({ coordinate }) => coordinate).filter(validCoordinate),
  ]
  const projection = createMercatorProjection(positions)
  const aspectRatio = projection.bounds.width / Math.max(projection.bounds.height, 0.000001)
  const innerWidth = DEFAULT_WIDTH - PADDING * 2
  const innerHeight = clamp(innerWidth / Math.max(aspectRatio, 0.35), MIN_HEIGHT, MAX_HEIGHT)
  const width = DEFAULT_WIDTH
  const height = innerHeight + PADDING * 2
  const project = (coordinate) => projection.project(coordinate, {
    width,
    height,
    padding: PADDING,
  })
  const selectedCategories = new Set(state.selectedCategories ?? [])
  const search = String(state.search ?? '').trim().toLowerCase()
  const confirmedGeometryIds = new Set((graph.edges ?? []).flatMap((edge) => (
    edge.verificationStatus === 'confirmed' ? edge.sourceGeometryIds ?? [] : []
  )))

  const paths = spatialGeometries
    .filter(({ geometryType }) => geometryType === 'line_string')
    .map((geometry) => {
      const feature = featureById.get(geometry.sourceFeatureId)
      const family = familyKey(
        feature?.sourceFolderPath,
        feature?.sourceName,
        geometry.category,
      )
      const name = feature?.sourceName ?? geometry.name ?? 'Jalur sumber'
      return {
        id: geometry.id,
        sourceFeatureId: geometry.sourceFeatureId,
        name,
        family,
        color: FAMILY_COLORS[family],
        points: geometry.coordinates.map(project).filter(Boolean),
        confirmed: confirmedGeometryIds.has(geometry.id),
        dimmed: isDimmed({
          family,
          searchable: `${name} ${feature?.sourceFolderPath ?? ''} ${geometry.id}`,
          selectedCategories,
          search,
        }),
      }
    })
    .filter(({ points }) => points.length > 1)

  const assetByCoordinate = new Map(assets
    .filter(({ coordinate }) => validCoordinate(coordinate))
    .map((asset) => [coordinateKey(asset.coordinate), asset]))
  const graphNodes = (graph.nodes ?? []).flatMap((node) => {
    const sourceGeometry = (geometryByFeatureId.get(node.sourceFeatureId) ?? [])
      .find(({ geometryType }) => geometryType === 'point')
    if (!sourceGeometry || !validCoordinate(sourceGeometry.coordinates)) return []
    const feature = featureById.get(node.sourceFeatureId)
    const mapAsset = assetByCoordinate.get(coordinateKey(sourceGeometry.coordinates))
    if (assets.length && !mapAsset) return []
    const family = familyKey(node.networkFamily, node.assetType, feature?.sourceFolderPath)
    const name = feature?.sourceName ?? mapAsset?.name ?? node.assetId ?? node.id
    const point = project(sourceGeometry.coordinates)
    return [{
      id: node.id,
      sourceFeatureId: node.sourceFeatureId,
      mapAssetId: mapAsset?.id ?? null,
      name,
      type: node.assetType ?? mapAsset?.type ?? 'Aset',
      family,
      color: FAMILY_COLORS[family],
      coordinate: sourceGeometry.coordinates,
      x: point.x,
      y: point.y,
      degree: graph.degreeByNode?.[node.id] ?? 0,
      selected: node.id === state.selectedAssetId,
      candidateCount: openCandidates.filter(({ targetAssetId }) => targetAssetId === node.id).length,
      dimmed: isDimmed({
        family,
        searchable: `${name} ${node.id} ${node.assetType ?? ''}`,
        selectedCategories,
        search,
      }),
    }]
  })
  const matchedMapAssetIds = new Set(graphNodes.map(({ mapAssetId }) => mapAssetId).filter(Boolean))
  const inventoryNodes = assets
    .filter(({ id, coordinate }) => (
      validCoordinate(coordinate) && !matchedMapAssetIds.has(id)
    ))
    .map((asset) => {
      const family = familyKey(asset.category, asset.type)
      const point = project(asset.coordinate)
      return {
        id: asset.id,
        mapAssetId: asset.id,
        name: asset.name,
        type: asset.type,
        family,
        color: FAMILY_COLORS[family],
        coordinate: asset.coordinate,
        x: point.x,
        y: point.y,
        degree: asset.relationCount ?? 0,
        selected: asset.id === state.selectedAssetId,
        candidateCount: openCandidates.filter(({ targetCoordinate }) => (
          validCoordinate(targetCoordinate)
          && coordinateKey(targetCoordinate) === coordinateKey(asset.coordinate)
        )).length,
        dimmed: isDimmed({
          family,
          searchable: `${asset.name} ${asset.id} ${asset.type}`,
          selectedCategories,
          search,
        }),
      }
    })
  const nodes = [...graphNodes, ...inventoryNodes]

  const spatialCandidates = openCandidates.flatMap((candidate) => {
    const source = project(candidate.sourceCoordinate)
    const target = project(candidate.targetCoordinate)
    if (!source || !target) return []
    const family = familyKey(candidate.networkFamily)
    return [{
      ...candidate,
      family,
      color: candidate.candidateStatus === 'ambiguous' ? '#fb923c' : '#f4bf4f',
      source,
      target,
      selected: candidate.candidateId === state.selectedCandidateId,
      sourceName: featureById.get(candidate.sourceFeatureId)?.sourceName
        ?? candidate.sourcePathAssetId,
      targetName: featureById.get(candidate.targetFeatureId)?.sourceName
        ?? candidate.targetAssetId
        ?? candidate.targetPathAssetId
        ?? 'Target belum tersedia',
      dimmed: isDimmed({
        family,
        searchable: [
          candidate.candidateId,
          candidate.sourcePathAssetId,
          candidate.targetAssetId,
          featureById.get(candidate.sourceFeatureId)?.sourceName,
          featureById.get(candidate.targetFeatureId)?.sourceName,
        ].filter(Boolean).join(' '),
        selectedCategories,
        search,
      }),
    }]
  })

  const unresolvedEndpoints = unresolved.flatMap((endpoint) => {
    const point = project(endpoint.coordinate)
    if (!point) return []
    const featureId = spatialGeometries.find(({ id }) => (
      id === endpoint.sourceGeometryId
    ))?.sourceFeatureId
    const feature = featureById.get(featureId)
    const family = familyKey(feature?.sourceFolderPath, feature?.sourceName)
    return [{
      ...endpoint,
      id: endpoint.sourceEndpointId,
      name: feature?.sourceName ?? endpoint.sourcePathAssetId ?? 'Endpoint',
      family,
      x: point.x,
      y: point.y,
      selected: endpoint.sourceEndpointId === state.selectedUnresolvedId,
      dimmed: isDimmed({
        family,
        searchable: `${feature?.sourceName ?? ''} ${endpoint.sourceEndpointId}`,
        selectedCategories,
        search,
      }),
    }]
  })

  return {
    width,
    height,
    bounds: projection.bounds,
    paths,
    nodes,
    candidates: spatialCandidates,
    unresolved: unresolvedEndpoints,
    categories: Object.keys(FAMILY_COLORS).filter((family) => (
      paths.some((path) => path.family === family)
      || nodes.some((node) => node.family === family)
      || spatialCandidates.some((candidate) => candidate.family === family)
    )),
    graphNodeCount: nodes.length,
    graphEdgeCount: (graph.edges ?? []).filter(({ verificationStatus }) => (
      verificationStatus === 'confirmed'
    )).length,
    pathCount: paths.length,
  }
}

export function projectMercatorCoordinate(coordinate, bounds, {
  width,
  height,
  padding = PADDING,
}) {
  if (!validCoordinate(coordinate)) return null
  const projected = toMercator(coordinate)
  const usableWidth = Math.max(width - padding * 2, 1)
  const usableHeight = Math.max(height - padding * 2, 1)
  return {
    x: padding + ((projected.x - bounds.west) / Math.max(bounds.width, 0.000001))
      * usableWidth,
    y: padding + ((projected.y - bounds.north) / Math.max(bounds.height, 0.000001))
      * usableHeight,
  }
}

function createMercatorProjection(positions) {
  const projected = positions.filter(validCoordinate).map(toMercator)
  const safe = projected.length ? projected : [toMercator([117, -2]), toMercator([117.01, -2.01])]
  const west = Math.min(...safe.map(({ x }) => x))
  const east = Math.max(...safe.map(({ x }) => x))
  const north = Math.min(...safe.map(({ y }) => y))
  const south = Math.max(...safe.map(({ y }) => y))
  const bounds = {
    west,
    east,
    north,
    south,
    width: Math.max(east - west, 0.000001),
    height: Math.max(south - north, 0.000001),
  }
  return {
    bounds,
    project(coordinate, viewport) {
      return projectMercatorCoordinate(coordinate, bounds, viewport)
    },
  }
}

function toMercator(coordinate) {
  const longitude = Number(coordinate[0])
  const latitude = clamp(Number(coordinate[1]), -85.051129, 85.051129)
  const radians = latitude * Math.PI / 180
  return {
    x: (longitude + 180) / 360,
    y: (1 - Math.log(Math.tan(radians) + (1 / Math.cos(radians))) / Math.PI) / 2,
  }
}

function normalizeSourceGeometries(geometries) {
  return geometries.flatMap((geometry) => {
    const type = normalizeGeometryType(geometry.geometryType)
    if (!type || geometry.valid === false) return []
    return [{
      id: geometry.geometryId,
      sourceFeatureId: geometry.sourceFeatureId,
      geometryType: type,
      coordinates: structuredClone(geometry.coordinates),
    }]
  })
}

function normalizeMapGeometries(geometries) {
  return geometries.map((geometry) => ({
    id: geometry.id,
    sourceFeatureId: geometry.sourceNodeId ?? geometry.assetId,
    geometryType: normalizeGeometryType(geometry.geometryType),
    coordinates: structuredClone(geometry.coordinates),
    category: geometry.category,
    name: geometry.ownerName,
  })).filter(({ geometryType }) => Boolean(geometryType))
}

function filterToMapVisibility(sourceGeometries, mapGeometries) {
  if (!mapGeometries.length) return sourceGeometries
  const visibleGeometryKeys = new Set(mapGeometries.map(geometryKey))
  return sourceGeometries.filter((geometry) => visibleGeometryKeys.has(geometryKey(geometry)))
}

function geometryKey(geometry) {
  return `${geometry.geometryType}:${JSON.stringify(geometry.coordinates)}`
}

function normalizeGeometryType(value) {
  const normalized = String(value ?? '').replaceAll('-', '_').toLowerCase()
  if (normalized === 'point') return 'point'
  if (['linestring', 'line_string'].includes(normalized)) return 'line_string'
  if (normalized === 'polygon') return 'polygon'
  return null
}

function extractPositions(geometry) {
  if (geometry.geometryType === 'point') return [geometry.coordinates].filter(validCoordinate)
  if (geometry.geometryType === 'line_string') {
    return (geometry.coordinates ?? []).filter(validCoordinate)
  }
  if (geometry.geometryType === 'polygon') {
    return (geometry.coordinates ?? []).flat().filter(validCoordinate)
  }
  return []
}

function familyKey(...values) {
  const value = values.filter(Boolean).join(' ').toLowerCase().replaceAll('_', ' ')
  if (/cctv|camera|kamera|nvr|junction/.test(value)) return 'cctv'
  if (/fiber|fibre|\bfo\b/.test(value)) return 'fiber-optic'
  if (/\blan\b|utp/.test(value)) return 'lan'
  if (/printer|peripheral|access point|\bap\b/.test(value)) return 'peripheral'
  if (/switch|router|server|rack|otb|core|infra|power|tiang/.test(value)) {
    return 'infrastructure'
  }
  return 'unmapped'
}

function isDimmed({ family, searchable, selectedCategories, search }) {
  return (selectedCategories.size > 0 && !selectedCategories.has(family))
    || (search && !String(searchable).toLowerCase().includes(search))
}

function coordinateKey(coordinate) {
  return `${Number(coordinate[0]).toFixed(9)}:${Number(coordinate[1]).toFixed(9)}`
}

function validCoordinate(value) {
  return Array.isArray(value)
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
}

function groupBy(records, key) {
  const result = new Map()
  records.forEach((record) => {
    result.set(record[key], [...(result.get(record[key]) ?? []), record])
  })
  return result
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}
