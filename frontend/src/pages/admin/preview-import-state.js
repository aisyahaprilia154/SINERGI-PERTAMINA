const GEOMETRY_TYPES = ['point', 'line_string', 'polygon', 'multi_geometry']

export function buildImportPreviewModel(payload) {
  const changes = new Map(
    (payload.comparison?.assetChanges ?? []).map(({ assetId, status }) => [assetId, status]),
  )
  const candidate = buildDatasetModel({
    assets: payload.assets,
    geometries: payload.geometries,
    relations: payload.relations,
    layers: payload.layers,
    issues: payload.issues,
    changes,
  })
  const active = payload.activeDatasetVersion
    ? buildDatasetModel({
      ...payload.activeDatasetVersion,
      issues: [],
      changes: new Map(),
    })
    : null
  const removed = buildDatasetModel({
    assets: (payload.comparison?.removedAssets ?? []).map(({ asset }) => asset),
    geometries: (payload.comparison?.removedAssets ?? []).flatMap(
      ({ geometries }) => geometries,
    ),
    relations: [],
    layers: active?.layers ?? [],
    issues: [],
    changes: new Map(
      (payload.comparison?.removedAssets ?? []).map(({ asset }) => [asset.assetId, 'removed']),
    ),
  })

  return {
    payload,
    candidate,
    active,
    removed,
    categories: unique(candidate.assets.map(({ category }) => category || 'Unmapped')),
    geometryTypes: unique(candidate.geometries.map(({ geometryType }) => geometryType)),
    issueSeverities: unique((payload.issues ?? []).map(({ severity }) => severity)),
  }
}

export function createImportPreviewState(model) {
  return {
    viewMode: 'candidate',
    showChanges: true,
    showIssues: true,
    visibleLayerIds: new Set(model.candidate.layers.map(({ id }) => id)),
    visibleCategories: new Set(model.categories),
    visibleGeometryTypes: new Set(model.geometryTypes.length
      ? model.geometryTypes
      : GEOMETRY_TYPES),
    visibleIssueSeverities: new Set(model.issueSeverities),
    selectedAssetId: null,
    selectedIssueId: null,
    traceAssetIds: new Set(),
    zoom: 1,
    focusBounds: null,
    sidebarOpen: false,
    actionStatus: 'idle',
    actionMessage: '',
    activeMapUrl: null,
    confirmBreakingChanges: false,
  }
}

export function getVisiblePreviewData(model, state) {
  const source = state.viewMode === 'active' && model.active
    ? model.active
    : model.candidate
  const filteredAssets = source.assets.filter((asset) => {
    const layerVisible = !asset.layerId || state.visibleLayerIds.has(asset.layerId)
    const categoryVisible = state.visibleCategories.has(asset.category || 'Unmapped')
    const issueVisible = !state.showIssues
      || !asset.issues.length
      || asset.issues.some(({ severity }) => state.visibleIssueSeverities.has(severity))
    return layerVisible && categoryVisible && issueVisible
  })
  const assetNodeIds = new Set(filteredAssets.map(({ id }) => id))
  let geometries = source.geometries.filter((geometry) => (
    assetNodeIds.has(geometry.assetNodeId)
      && state.visibleGeometryTypes.has(geometry.geometryType)
  ))
  let assets = filteredAssets.filter(
    (asset) => geometries.some(({ assetNodeId }) => assetNodeId === asset.id)
      || !source.geometriesByAssetNode.has(asset.id),
  )

  if (state.showChanges && state.viewMode === 'candidate') {
    const removedAssets = model.removed.assets.filter((asset) => (
      state.visibleCategories.has(asset.category || 'Unmapped')
    ))
    const removedIds = new Set(removedAssets.map(({ id }) => id))
    assets = [...assets, ...removedAssets]
    geometries = [
      ...geometries,
      ...model.removed.geometries.filter((geometry) => (
        removedIds.has(geometry.assetNodeId)
          && state.visibleGeometryTypes.has(geometry.geometryType)
      )),
    ]
  }

  return {
    source,
    assets,
    geometries,
    relations: source.relations,
    bounds: calculateGeometryBounds(geometries),
  }
}

export function findConnectedAssetIds(model, startAssetId) {
  const graph = new Map()
  model.candidate.assets.forEach(({ assetId }) => graph.set(assetId, new Set()))
  model.candidate.relations.forEach(({ sourceAssetId, targetAssetId }) => {
    if (!graph.has(sourceAssetId) || !graph.has(targetAssetId)) return
    graph.get(sourceAssetId).add(targetAssetId)
    graph.get(targetAssetId).add(sourceAssetId)
  })
  if (!graph.has(startAssetId)) return new Set()
  const visited = new Set([startAssetId])
  const queue = [startAssetId]
  while (queue.length) {
    const current = queue.shift()
    graph.get(current).forEach((next) => {
      if (visited.has(next)) return
      visited.add(next)
      queue.push(next)
    })
  }
  return visited
}

export function calculateAssetBounds(model, assetId) {
  const asset = [...model.candidate.assets, ...model.removed.assets]
    .find((candidate) => candidate.assetId === assetId)
  if (!asset) return null
  return calculateGeometryBounds([
    ...(model.candidate.geometriesByAssetNode.get(asset.id) ?? []),
    ...(model.removed.geometriesByAssetNode.get(asset.id) ?? []),
  ])
}

export function calculateGeometryBounds(geometries) {
  const positions = geometries.flatMap((geometry) => extractPositions(geometry))
    .filter(isValidPosition)
  if (!positions.length) return null
  const longitudes = positions.map(([longitude]) => longitude)
  const latitudes = positions.map(([, latitude]) => latitude)
  const west = Math.min(...longitudes)
  const east = Math.max(...longitudes)
  const south = Math.min(...latitudes)
  const north = Math.max(...latitudes)
  const longitudePad = Math.max((east - west) * 0.08, 0.0004)
  const latitudePad = Math.max((north - south) * 0.08, 0.0004)
  return {
    west: west - longitudePad,
    east: east + longitudePad,
    south: south - latitudePad,
    north: north + latitudePad,
  }
}

export function extractPositions(geometry) {
  if (!geometry) return []
  if (geometry.geometryType === 'point') return [geometry.coordinates]
  if (geometry.geometryType === 'line_string') return geometry.coordinates ?? []
  if (geometry.geometryType === 'polygon') return (geometry.coordinates ?? []).flat()
  if (geometry.geometryType === 'multi_geometry') {
    return (geometry.coordinates ?? []).flatMap((child) => (
      child?.geometryType ? extractPositions(child) : []
    ))
  }
  return []
}

function buildDatasetModel({
  assets = [],
  geometries = [],
  relations = [],
  layers = [],
  issues = [],
  changes = new Map(),
}) {
  const geometriesByAssetNode = groupBy(geometries, 'assetNodeId')
  const issuesByAssetId = groupBy(issues.filter(({ assetId }) => assetId), 'assetId')
  const enrichedAssets = assets.map((asset) => ({
    ...asset,
    changeStatus: changes.get(asset.assetId) ?? 'unchanged',
    issues: issuesByAssetId.get(asset.assetId) ?? [],
  }))
  return {
    assets: enrichedAssets,
    assetsByAssetId: new Map(enrichedAssets.map((asset) => [asset.assetId, asset])),
    geometries,
    geometriesByAssetNode,
    relations,
    layers,
    issues,
  }
}

function groupBy(records, key) {
  const result = new Map()
  records.forEach((record) => {
    result.set(record[key], [...(result.get(record[key]) ?? []), record])
  })
  return result
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'id'))
}

function isValidPosition(position) {
  return Array.isArray(position)
    && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1]))
}
