export const DEFAULT_SITE_SCOPE_ID = 'pengapon'

export const SITE_SCOPE_MAPPING = deepFreeze({
  pengapon: {
    displayName: 'Pengapon',
    folderAliases: [
      '/RJBT/FT PENGAPON - SEMARANG/',
      '/RJBT/FT PENGAPON/',
    ],
  },
})

export function resolveSiteScope(siteScopeId) {
  const normalizedId = String(siteScopeId ?? '').trim().toLowerCase()
  const resolvedId = Object.hasOwn(SITE_SCOPE_MAPPING, normalizedId)
    ? normalizedId
    : DEFAULT_SITE_SCOPE_ID
  const mapping = SITE_SCOPE_MAPPING[resolvedId]
  return {
    id: resolvedId,
    displayName: mapping.displayName,
    folderAliases: [...mapping.folderAliases],
    requestedId: normalizedId || null,
    usedFallback: normalizedId !== resolvedId,
  }
}

export function normalizeSourceFolderPath(value) {
  const segments = String(value ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  return segments.length ? `/${segments.join('/')}`.toLowerCase() : '/'
}

export function sourceFolderMatchesSite(sourceFolderPath, siteScopeId) {
  const siteScope = resolveSiteScope(siteScopeId)
  const normalizedPath = normalizeSourceFolderPath(sourceFolderPath)
  return siteScope.folderAliases.some((alias) => {
    const normalizedAlias = normalizeSourceFolderPath(alias)
    return normalizedPath === normalizedAlias
      || normalizedPath.startsWith(`${normalizedAlias}/`)
  })
}

/**
 * Filters normalized active-version records before projection, semantic
 * grouping, topology construction, search, tracing, diagrams, and export.
 * Source records and sourceFolderPath values are cloned, never rewritten.
 */
export function scopeActiveDatasetRecordsToSite(datasetMapData, siteScopeId) {
  if (!datasetMapData?.datasetVersion || !Array.isArray(datasetMapData.assets)) {
    throw new TypeError('Dataset aktif tidak valid untuk site scope.')
  }

  const siteScope = resolveSiteScope(siteScopeId)
  const sourceLayers = Array.isArray(datasetMapData.layers) ? datasetMapData.layers : []
  const sourceAssets = datasetMapData.assets
  const sourceGeometries = Array.isArray(datasetMapData.geometries)
    ? datasetMapData.geometries
    : []
  const sourceRelations = Array.isArray(datasetMapData.relations)
    ? datasetMapData.relations
    : []
  const layerById = new Map(sourceLayers.map((layer) => [layer.id, layer]))
  const matchedLayerIds = new Set(sourceLayers
    .filter((layer) => sourceFolderMatchesSite(layer.sourceFolderPath, siteScope.id))
    .map(({ id }) => id))

  const scopedSourceAssets = sourceAssets.filter((asset) => (
    matchedLayerIds.has(asset.layerId)
    || sourceFolderMatchesSite(readAssetFolderPath(asset, layerById), siteScope.id)
  ))
  const scopedSourceNodeIds = new Set(scopedSourceAssets.map(({ id }) => id))
  const scopedStableAssetIds = new Set(scopedSourceAssets.flatMap((asset) => (
    [asset.id, asset.assetId].filter(Boolean)
  )))
  const scopedGeometries = sourceGeometries
    .filter((geometry) => scopedSourceNodeIds.has(geometry.assetNodeId))
    .map((geometry) => withSiteScope(geometry, siteScope))
  const scopedRelations = sourceRelations
    .filter((relation) => (
      scopedStableAssetIds.has(relation.sourceNodeId || relation.sourceAssetId)
      && scopedStableAssetIds.has(relation.targetNodeId || relation.targetAssetId)
    ))
    .map((relation) => withSiteScope(relation, siteScope))
  const scopedLayers = sourceLayers
    .filter((layer) => matchedLayerIds.has(layer.id))
    .map((layer) => withSiteScope({
      ...layer,
      parentLayerId: matchedLayerIds.has(layer.parentLayerId) ? layer.parentLayerId : null,
      defaultVisible: hasVisibleLayerAncestry(layer, layerById),
    }, siteScope))
  const scopedAssets = scopedSourceAssets.map((asset) => withSiteScope(asset, siteScope))
  const excludedAssetIds = new Set(sourceAssets
    .filter((asset) => !scopedSourceNodeIds.has(asset.id))
    .map(({ id }) => id))

  return {
    ...datasetMapData,
    layers: scopedLayers,
    assets: scopedAssets,
    geometries: scopedGeometries,
    relations: scopedRelations,
    siteScope,
    scopeSummary: {
      siteScopeId: siteScope.id,
      siteScopeName: siteScope.displayName,
      sourceLayerCount: sourceLayers.length,
      sourceAssetCount: sourceAssets.length,
      sourceGeometryCount: sourceGeometries.length,
      sourceRelationCount: sourceRelations.length,
      scopedLayerCount: scopedLayers.length,
      scopedAssetCount: scopedAssets.length,
      scopedGeometryCount: scopedGeometries.length,
      scopedRelationCount: scopedRelations.length,
      excludedLayerCount: sourceLayers.length - scopedLayers.length,
      excludedAssetCount: excludedAssetIds.size,
      excludedGeometryCount: sourceGeometries.length - scopedGeometries.length,
      excludedRelationCount: sourceRelations.length - scopedRelations.length,
    },
  }
}

function readAssetFolderPath(asset, layerById) {
  return asset?.sourceFolderPath
    ?? asset?.properties?.sourceFolderPath
    ?? layerById.get(asset?.layerId)?.sourceFolderPath
    ?? ''
}

function withSiteScope(record, siteScope) {
  return {
    ...structuredClone(record),
    siteScopeId: siteScope.id,
    siteScopeName: siteScope.displayName,
  }
}

function hasVisibleLayerAncestry(layer, layerById) {
  const visited = new Set()
  let current = layer
  while (current && !visited.has(current.id)) {
    if (current.defaultVisible === false) return false
    visited.add(current.id)
    current = current.parentLayerId ? layerById.get(current.parentLayerId) : null
  }
  return true
}

function deepFreeze(value) {
  Object.values(value).forEach((item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) deepFreeze(item)
  })
  return Object.freeze(value)
}
