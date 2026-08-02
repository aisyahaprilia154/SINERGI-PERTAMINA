import { buildTopologyGraph } from '../domain/topology-builder.js'
import {
  DEFAULT_SITE_SCOPE_ID,
  scopeActiveDatasetRecordsToSite,
} from '../domain/site-scope.js'
import {
  deriveAssetDisplayName,
  normalizeAssetDisplayFields,
  resolveDuplicateShortLabels,
} from '../domain/asset-display-name.js'
import { buildRelationReadinessIndex } from '../domain/relation-readiness.js'

const CATEGORY_STYLE = Object.freeze({
  cctv: { color: '#9698f4', softColor: '#f1f1fe', type: 'CCTV', order: 1 },
  'cctv-cable': { color: '#9698f4', softColor: '#f1f1fe', type: 'CCTV cable', order: 2 },
  'fiber-optic': { color: '#70cfb5', softColor: '#edf8f5', type: 'Fiber optic', order: 3 },
  lan: { color: '#aeb8c5', softColor: '#f1f3f5', type: 'LAN', order: 4 },
  infrastructure: { color: '#efc363', softColor: '#fcf6e8', type: 'Infrastructure', order: 5 },
  peripheral: { color: '#a88af3', softColor: '#f5f1fe', type: 'Peripheral', order: 6 },
  unmapped: { color: '#aeb8c5', softColor: '#f1f3f5', type: 'Belum terpetakan', order: 99 },
})

/**
 * Converts one active dataset version into the stable map view model.
 *
 * Persistence assets remain one-per-Placemark. The runtime view intentionally
 * separates Point nodes from line/polygon geometry so a cable or area is not
 * counted as a selectable node. Source coordinates remain immutable; projected
 * display coordinates exist only on the returned view model.
 */
export function adaptActiveDatasetForMap(payload, { siteScopeId = null } = {}) {
  if (siteScopeId) return scopeDatasetToSite(payload, siteScopeId)
  return adaptDatasetRecordsForMap(payload)
}

/**
 * Creates the single scoped domain consumed by the map, sidebar, tracing,
 * schematic diagram, viewport selection, and contextual export.
 */
export function scopeDatasetToSite(payload, siteScopeId = DEFAULT_SITE_SCOPE_ID) {
  const scopedSource = scopeActiveDatasetRecordsToSite(payload, siteScopeId)
  const mapData = adaptDatasetRecordsForMap(scopedSource)
  const scopedBounds = geometryBounds(mapData.geometries)
  const scopeSummary = {
    ...scopedSource.scopeSummary,
    visibleObjectCount: mapData.geometries.length,
    visibleNodeCount: mapData.counts.assetNodeCount,
    visibleLineCount: mapData.counts.lineCount,
    visiblePolygonCount: mapData.counts.polygonCount,
    networkCount: mapData.counts.networkCount,
  }
  return {
    ...mapData,
    scopedLayers: mapData.layers,
    scopedAssets: mapData.assets,
    scopedGeometries: mapData.geometries,
    scopedRelations: mapData.topologyGraph.edges,
    scopedNetworks: mapData.networks,
    scopedTopologyGraph: mapData.topologyGraph,
    scopedBounds,
    scopeSummary,
  }
}

function adaptDatasetRecordsForMap(payload) {
  if (!payload?.datasetVersion || !Array.isArray(payload.assets)) {
    throw new TypeError('Response dataset aktif tidak valid.')
  }

  const layers = normalizeLayers(payload.layers ?? [])
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))
  const ownerByNodeId = new Map(payload.assets.map((asset) => [asset.id, asset]))
  const geometryParts = (payload.geometries ?? [])
    .flatMap(splitGeometryRecord)
    .filter(isRenderableGeometry)
    .map((geometry) => {
      const owner = ownerByNodeId.get(geometry.assetNodeId)
      const layer = layerById.get(owner?.layerId)
      return {
        ...geometry,
        owner,
        layer,
        sourceStatus: sourceStatusFor(owner, layer),
      }
    })
  const visibleGeometryParts = geometryParts.filter(({ sourceStatus }) => (
    sourceStatus === 'visible'
  ))
  const bounds = positionBounds(visibleGeometryParts.flatMap(extractPositions))
  const allMapGeometries = geometryParts.map((geometry) => toMapGeometry(geometry, bounds))
  const geometries = allMapGeometries.filter(({ sourceStatus }) => sourceStatus === 'visible')
  const geometriesByOwner = groupBy(allMapGeometries, 'sourceNodeId')

  const exportAssets = resolveDuplicateShortLabels(payload.assets.map((asset) => createOwnerFeature({
    asset,
    layer: layerById.get(asset.layerId),
    geometries: geometriesByOwner.get(asset.id) ?? [],
  })))
  const featureByAssetId = new Map(exportAssets.map((asset) => [asset.id, asset]))

  const assets = exportAssets
    .filter((asset) => asset.sourceStatus === 'visible')
    .map((asset) => createMapNode(asset))
    .filter(Boolean)
  const assetById = Object.fromEntries(assets.map((asset) => [asset.id, asset]))
  const validNodeIds = new Set(assets.map(({ id }) => id))
  const topologyGraph = annotateTopologyGraph(buildTopologyGraph({
    assets: payload.assets,
    geometries: payload.geometries ?? [],
    relations: payload.relations ?? [],
    layers,
    config: payload.topologyConfig ?? {},
    siteScopeId: payload.siteScope?.id ?? null,
    datasetVersionId: payload.datasetVersion.id,
  }), payload.siteScope)
  const relations = topologyGraph.edges
    .filter((edge) => (
      validNodeIds.has(edge.sourceNodeId)
      && validNodeIds.has(edge.targetNodeId)
      && edge.sourceNodeId !== edge.targetNodeId
    ))
    .map((edge) => ({
      ...edge,
      sourceAssetId: edge.sourceNodeId,
      targetAssetId: edge.targetNodeId,
    }))
  const networks = createSemanticNetworks({
    nodes: assets,
    geometries,
    relations,
    topologyGraph,
    featureByAssetId,
    layerById,
  })
  const networkIdsByAssetId = new Map()
  networks.forEach((network) => {
    network.nodeIds.forEach((assetId) => {
      networkIdsByAssetId.set(
        assetId,
        [...(networkIdsByAssetId.get(assetId) ?? []), network.id],
      )
    })
  })
  assets.forEach((asset) => {
    asset.networkIds = networkIdsByAssetId.get(asset.id) ?? []
    asset.relationCount = relations.filter((relation) => (
      relation.sourceAssetId === asset.id || relation.targetAssetId === asset.id
    )).length
  })
  exportAssets.forEach((asset) => {
    asset.networkIds = networkIdsByAssetId.get(asset.id) ?? []
  })
  const relationReadiness = buildRelationReadinessIndex({
    topologyGraph,
    assets,
    networks,
    layers,
  })
  assets.forEach((asset) => {
    asset.relationReadiness = relationReadiness.assetsById[asset.id]
  })
  networks.forEach((network) => {
    network.relationReadiness = relationReadiness.networksById[network.id]
  })
  layers.forEach((layer) => {
    layer.relationReadiness = relationReadiness.layersById[layer.id]
  })
  topologyGraph.relationReadiness = relationReadiness.scope

  const counts = {
    networkCount: networks.length,
    layerCount: layers.length,
    assetCount: exportAssets.length,
    assetNodeCount: assets.length,
    pointCount: geometries.filter(({ geometryType }) => geometryType === 'point').length,
    lineCount: geometries.filter(({ geometryType }) => geometryType === 'line_string').length,
    polygonCount: geometries.filter(({ geometryType }) => geometryType === 'polygon').length,
    geometryCount: geometries.length,
    confirmedRelationCount: topologyGraph.edges.length,
    inferredPendingCount: topologyGraph.candidateEdges?.length ?? 0,
    unresolvedRelationCount: topologyGraph.unresolvedEndpoints?.length ?? 0,
    isolatedAssetCount: topologyGraph.isolatedNodes?.length ?? 0,
    hiddenPlacemarkCount: exportAssets.filter(({ sourceStatus }) => sourceStatus === 'hidden').length,
  }

  return {
    activeContext: {
      branchId: payload.datasetVersion.branchId,
      branchName: payload.siteScope?.displayName || formatName(payload.datasetVersion.branchId),
      datasetBranchName: formatName(payload.datasetVersion.branchId),
      datasetId: payload.datasetVersion.datasetId,
      datasetVersionId: payload.datasetVersion.id,
      datasetName: payload.datasetVersion.versionName,
      version: payload.datasetVersion.versionName,
      sourceFilename: payload.datasetVersion.sourceFilename,
      publishedAt: payload.datasetVersion.activatedAt || payload.activePointer?.activatedAt,
      activePointerRevision: payload.activePointer?.revision,
      ...(payload.siteScope ? {
        siteScopeId: payload.siteScope.id,
        siteScopeName: payload.siteScope.displayName,
      } : {}),
    },
    assets,
    assetById,
    geometries,
    exportAssets,
    networks,
    topologyGraph,
    relationReadiness,
    layers,
    counts,
    renderingSummary: {
      ...structuredClone(payload.renderingSummary ?? {}),
      ...counts,
      assetsWithoutGeometry: exportAssets.filter(({ geometry }) => !geometry.length).length,
    },
    ...(payload.siteScope ? {
      siteScope: structuredClone(payload.siteScope),
      scopeSummary: structuredClone(payload.scopeSummary),
    } : {}),
    hasRenderableData: geometries.length > 0,
  }
}

export function adaptActiveAssetDetail(payload, mapAsset) {
  if (!payload?.asset || payload.asset.assetId !== mapAsset?.id) {
    throw new TypeError('Response detail aset aktif tidak valid.')
  }
  const asset = payload.asset
  const properties = structuredClone(asset.properties ?? {})
  const displayName = deriveAssetDisplayName({
    ...mapAsset,
    sourceName: asset.name || mapAsset.sourceName,
    properties,
  })
  return {
    ...mapAsset,
    sourceName: asset.name || mapAsset.sourceName,
    displayName,
    name: displayName,
    category: asset.category || mapAsset.category,
    type: normalizeAssetType(asset.type, asset.category),
    assetType: normalizeAssetType(asset.type, asset.category),
    location: asset.location
      || readProperty(asset, 'location')
      || readProperty(asset, 'description')
      || mapAsset.location,
    status: readProperty(asset, 'status') || mapAsset.status,
    ip: readProperty(asset, 'ipAddress') || readProperty(asset, 'ip_address') || '—',
    owner: readProperty(asset, 'owner') || 'Tidak tersedia',
    properties,
  }
}

function createOwnerFeature({ asset, layer, geometries }) {
  const category = normalizeCategory(asset.category, asset.type, layer)
  const type = normalizeAssetType(asset.type, asset.category || category, layer)
  const explicitStatus = readProperty(asset, 'status')
  const displayFields = normalizeAssetDisplayFields({
    ...asset,
    stableId: asset.assetId,
    sourceName: asset.name,
    assetType: type,
    type,
    category,
  }, {
    sourceFolderPath: layer?.sourceFolderPath
      ?? asset.properties?.sourceIdentityMapping?.sourceFolderPath,
  })
  return {
    id: displayFields.stableId,
    stableId: displayFields.stableId,
    assetId: displayFields.assetId,
    sourceNodeId: asset.id,
    sourceName: displayFields.sourceName,
    displayName: displayFields.displayName,
    shortLabel: displayFields.shortLabel,
    name: displayFields.displayName,
    sourceFolderPath: displayFields.sourceFolderPath,
    type,
    assetType: type,
    category,
    status: explicitStatus || 'Status tidak tersedia',
    issueCount: Number.isInteger(asset.issueCount) ? asset.issueCount : 0,
    hasIssue: Number(asset.issueCount) > 0,
    sourceStatus: sourceStatusFor(asset, layer),
    location: asset.location
      || readProperty(asset, 'location')
      || readProperty(asset, 'description')
      || 'Lokasi tidak tersedia',
    datasetVersionId: asset.datasetVersionId,
    layerId: asset.layerId,
    networkIds: [],
    properties: structuredClone(asset.properties ?? {}),
    sourcePlacemarkId: asset.sourcePlacemarkId ?? null,
    ...(asset.siteScopeId ? {
      siteScopeId: asset.siteScopeId,
      siteScopeName: asset.siteScopeName,
    } : {}),
    geometry: geometries.map((geometry) => structuredClone(geometry)),
  }
}

function createMapNode(owner) {
  const pointGeometry = owner.geometry.find(({ geometryType }) => geometryType === 'point')
  if (!pointGeometry || !validPosition(pointGeometry.coordinates)) return null
  const coordinate = structuredClone(pointGeometry.coordinates)
  const display = pointGeometry.displayCoordinates
  return {
    ...owner,
    coordinate,
    x: display.x,
    y: display.y,
    renderable: true,
    hasPointGeometry: true,
    isCoreNode: isCoreNode(owner.type),
    relationCount: 0,
  }
}

function createSemanticNetworks({
  nodes,
  geometries,
  relations,
  topologyGraph,
  featureByAssetId,
  layerById,
}) {
  const groups = new Map()
  const ensureGroup = (key) => {
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        nodeIds: new Set(),
        geometryIds: new Set(),
        assetIds: new Set(),
        layerIds: new Set(),
        relations: [],
      })
    }
    return groups.get(key)
  }

  nodes.forEach((node) => {
    const key = categoryKey(node.category, node.type)
    const group = ensureGroup(key)
    group.nodeIds.add(node.id)
    group.assetIds.add(node.id)
    if (node.layerId) group.layerIds.add(node.layerId)
  })
  geometries.forEach((geometry) => {
    const key = categoryKey(geometry.category, featureByAssetId.get(geometry.assetId)?.type)
    const group = ensureGroup(key)
    group.geometryIds.add(geometry.id)
    if (geometry.assetId) group.assetIds.add(geometry.assetId)
    if (geometry.layerId) group.layerIds.add(geometry.layerId)
  })
  relations.forEach((relation) => {
    const relationLayer = relation.layerId ? layerById.get(relation.layerId) : null
    const source = featureByAssetId.get(relation.sourceAssetId)
    const key = networkKeyFromRelation(relation)
      || categoryKey(
        relation.category || relationLayer?.category || source?.category,
        source?.type,
      )
    const group = ensureGroup(key)
    group.relations.push(structuredClone(relation))
    group.nodeIds.add(relation.sourceAssetId)
    group.nodeIds.add(relation.targetAssetId)
    group.assetIds.add(relation.sourceAssetId)
    group.assetIds.add(relation.targetAssetId)
    if (relation.layerId) group.layerIds.add(relation.layerId)
  })
  ;(topologyGraph?.candidateEdges ?? []).forEach((relation) => {
    const key = networkKeyFromRelation(relation)
      || categoryKey(relation.category)
    const group = ensureGroup(key)
    for (const assetId of [relation.sourceNodeId, relation.targetNodeId]) {
      if (!featureByAssetId.has(assetId)) continue
      group.nodeIds.add(assetId)
      group.assetIds.add(assetId)
      const layerId = featureByAssetId.get(assetId)?.layerId
      if (layerId) group.layerIds.add(layerId)
    }
  })

  return [...groups.values()]
    .filter((group) => (
      group.nodeIds.size || group.geometryIds.size || group.relations.length
    ))
    .sort((left, right) => styleFor(left.key).order - styleFor(right.key).order
      || left.key.localeCompare(right.key, 'id'))
    .map((group) => {
      const style = styleFor(group.key)
      const networkId = `network:${group.key}`
      const networkRelations = group.relations.map((relation) => ({
        ...relation,
        networkId,
      }))
      const networkGeometries = geometries.filter(({ id }) => group.geometryIds.has(id))
      const networkNodes = nodes.filter(({ id }) => group.nodeIds.has(id))
      const lineCount = networkGeometries.filter(
        ({ geometryType }) => geometryType === 'line_string',
      ).length
      const polygonCount = networkGeometries.filter(
        ({ geometryType }) => geometryType === 'polygon',
      ).length
      const nodePointGeometries = networkNodes.map((node) => ({
        geometryType: 'point',
        coordinates: node.coordinate,
        displayCoordinates: { x: node.x, y: node.y },
      }))
      const bounds = geometryBounds([...networkGeometries, ...nodePointGeometries])
      const displayBounds = geometryDisplayBounds([
        ...networkGeometries,
        ...nodePointGeometries,
      ])
      const subcategories = summarizeNetworkContent(networkNodes, lineCount, polygonCount)
      return {
        id: networkId,
        layerId: null,
        layerIds: [...group.layerIds],
        name: networkName(group.key),
        shortName: style.type,
        color: style.color,
        softColor: style.softColor,
        type: style.type,
        categoryKey: group.key,
        categoryLabel: style.type,
        assetCount: group.assetIds.size,
        nodeCount: group.nodeIds.size,
        lineCount,
        polygonCount,
        layerCount: group.layerIds.size,
        health: 'Aktif',
        description: `Data ${style.type} dari dataset version aktif.`,
        sourceFolderPath: null,
        parentLayerId: null,
        nodeIds: [...group.nodeIds],
        assetIds: [...group.assetIds],
        geometryIds: [...group.geometryIds],
        geometryAssetIds: [...group.assetIds],
        edges: networkRelations.map(({ sourceAssetId, targetAssetId }) => (
          [sourceAssetId, targetAssetId]
        )),
        relations: networkRelations,
        relationIds: networkRelations.map(({ id }) => id),
        subcategories,
        lineRole: lineRoleFor(
          group.key,
          networkGeometries,
          featureByAssetId,
          layerById,
        ),
        isDefaultVisible: true,
        ...(networkNodes[0]?.siteScopeId ? {
          siteScopeId: networkNodes[0].siteScopeId,
          siteScopeName: networkNodes[0].siteScopeName,
        } : networkGeometries[0]?.siteScopeId ? {
          siteScopeId: networkGeometries[0].siteScopeId,
          siteScopeName: networkGeometries[0].siteScopeName,
        } : {}),
        ...(bounds ? { bounds } : {}),
        ...(displayBounds ? { displayBounds } : {}),
      }
    })
}

function networkKeyFromRelation(relation) {
  const networkId = String(relation?.networkId ?? '')
  return networkId.startsWith('network:')
    ? networkId.slice('network:'.length)
    : null
}

function splitGeometryRecord(geometry) {
  if (!geometry || typeof geometry !== 'object') return []
  if (geometry.geometryType !== 'multi_geometry') {
    return [{
      id: geometry.id,
      sourceGeometryId: geometry.id,
      assetNodeId: geometry.assetNodeId,
      geometryType: geometry.geometryType,
      coordinates: structuredClone(geometry.coordinates),
      ...(geometry.altitudeMode ? { altitudeMode: geometry.altitudeMode } : {}),
      sourceGeometry: structuredClone(geometry.sourceGeometry ?? geometry),
    }]
  }

  return (geometry.coordinates ?? []).flatMap((child, index) => {
    if (!child || typeof child !== 'object' || child.geometryType === 'multi_geometry') return []
    return [{
      id: `${geometry.id}:part:${index + 1}`,
      sourceGeometryId: geometry.id,
      geometryPartIndex: index,
      assetNodeId: geometry.assetNodeId,
      geometryType: child.geometryType,
      coordinates: structuredClone(child.coordinates),
      ...(geometry.altitudeMode ? { altitudeMode: geometry.altitudeMode } : {}),
      sourceGeometry: structuredClone(geometry.sourceGeometry ?? geometry),
    }]
  })
}

function toMapGeometry(geometry, bounds) {
  const owner = geometry.owner
  const category = normalizeCategory(owner?.category, owner?.type, geometry.layer)
  return {
    id: geometry.id,
    sourceGeometryId: geometry.sourceGeometryId,
    ...(Number.isInteger(geometry.geometryPartIndex)
      ? { geometryPartIndex: geometry.geometryPartIndex }
      : {}),
    ...(owner?.assetId ? {
      assetId: owner.assetId,
      stableId: owner.assetId,
    } : {}),
    sourceNodeId: geometry.assetNodeId,
    geometryType: geometry.geometryType,
    coordinates: structuredClone(geometry.coordinates),
    displayCoordinates: projectGeometryCoordinates(geometry, bounds),
    layerId: owner?.layerId ?? geometry.layer?.id ?? null,
    category,
    sourceStatus: geometry.sourceStatus,
    ...(owner?.siteScopeId ? {
      siteScopeId: owner.siteScopeId,
      siteScopeName: owner.siteScopeName,
    } : {}),
    ...(geometry.altitudeMode ? { altitudeMode: geometry.altitudeMode } : {}),
    sourceGeometry: structuredClone(geometry.sourceGeometry),
  }
}

function normalizeLayers(layers) {
  const normalized = layers
    .filter((layer) => layer?.id && layer?.name)
    .map((layer, index) => ({
      id: layer.id,
      parentLayerId: layer.parentLayerId ?? null,
      sourceFolderPath: layer.sourceFolderPath ?? layer.name,
      name: layer.name,
      category: layer.category ?? 'unmapped',
      displayOrder: Number.isFinite(layer.displayOrder) ? layer.displayOrder : index,
      defaultVisible: layer.defaultVisible !== false,
      ...(layer.siteScopeId ? {
        siteScopeId: layer.siteScopeId,
        siteScopeName: layer.siteScopeName,
      } : {}),
    }))
    .sort((left, right) => left.displayOrder - right.displayOrder
      || left.name.localeCompare(right.name, 'id'))
  const layerById = new Map(normalized.map((layer) => [layer.id, layer]))
  return normalized.map((layer) => ({
    ...layer,
    defaultVisible: hasVisibleLayerAncestry(layer, layerById),
  }))
}

function annotateTopologyGraph(topologyGraph, siteScope) {
  if (!siteScope) return topologyGraph
  const scopeFields = {
    siteScopeId: siteScope.id,
    siteScopeName: siteScope.displayName,
  }
  return {
    ...topologyGraph,
    ...scopeFields,
    nodes: topologyGraph.nodes.map((node) => ({ ...node, ...scopeFields })),
    edges: topologyGraph.edges.map((edge) => ({ ...edge, ...scopeFields })),
    candidateEdges: (topologyGraph.candidateEdges ?? [])
      .map((edge) => ({ ...edge, ...scopeFields })),
    inferredEdges: (topologyGraph.inferredEdges ?? [])
      .map((edge) => ({ ...edge, ...scopeFields })),
    rejectedEdges: (topologyGraph.rejectedEdges ?? [])
      .map((edge) => ({ ...edge, ...scopeFields })),
    unresolvedRelations: (topologyGraph.unresolvedRelations ?? [])
      .map((edge) => ({ ...edge, ...scopeFields })),
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

function sourceStatusFor(asset, layer) {
  if (!asset) return 'invalid'
  const placemarkVisible = readProperty(asset, 'visibility')
  if (placemarkVisible === false || placemarkVisible === 0 || placemarkVisible === '0') {
    return 'hidden'
  }
  if (layer?.defaultVisible === false) return 'hidden'
  return 'visible'
}

function normalizeCategory(category, type, layer) {
  const key = categoryKey(category, type, layer?.name, layer?.sourceFolderPath)
  return styleFor(key).type
}

function normalizeAssetType(type, category, layer) {
  const source = `${type || ''} ${category || ''} ${layer?.name || ''} `
    + `${layer?.sourceFolderPath || ''}`
  const value = source.toLowerCase()
  if (value.includes('junction') || /\bjb\b/.test(value)) return 'Junction box'
  if (value.includes('core') && value.includes('switch')) return 'Core switch'
  if (value.includes('distribution') && value.includes('switch')) return 'Distribution switch'
  if (value.includes('switch') || value.includes('router')) return 'Access switch'
  if (value.includes('access point') || /\bap\b/.test(value)) return 'Access point'
  if (value.includes('otb')) return 'OTB'
  if (value.includes('server')) return 'Server'
  if (value.includes('printer')) return 'Printer'
  if (value.includes('nvr')) return 'NVR'
  if (value.includes('cctv') || value.includes('camera') || value.includes('kamera')) return 'CCTV'
  return type || category || 'Aset'
}

function categoryKey(...values) {
  const value = values.filter(Boolean).join(' ').toLowerCase()
  if ((value.includes('cctv') && (value.includes('cable') || value.includes('kabel')))
    || value.includes('backbone cctv')) return 'cctv-cable'
  if (value.includes('cctv') || value.includes('camera') || value.includes('kamera')
    || value.includes('nvr') || value.includes('junction') || /\bjb\b/.test(value)) {
    return 'cctv'
  }
  if (value.includes('fiber') || value.includes('fibre') || /\bfo\b/.test(value)) {
    return 'fiber-optic'
  }
  if (value.includes('lan') || value.includes('utp')) return 'lan'
  if (value.includes('peripheral') || value.includes('printer')
    || value.includes('access point') || /\bap\b/.test(value)) return 'peripheral'
  if (value.includes('infrastructure') || value.includes('switch')
    || value.includes('server') || value.includes('rack') || value.includes('otb')
    || value.includes('core') || value.includes('router') || value.includes('power')
    || value.includes('tiang') || value.includes('stp')) return 'infrastructure'
  return 'unmapped'
}

function styleFor(key) {
  return CATEGORY_STYLE[key] ?? CATEGORY_STYLE.unmapped
}

function networkName(key) {
  return {
    cctv: 'Jaringan CCTV',
    'cctv-cable': 'Kabel CCTV',
    'fiber-optic': 'Jaringan Fiber Optic',
    lan: 'Jaringan LAN',
    peripheral: 'Jaringan Peripheral',
    infrastructure: 'Jaringan Infrastruktur',
    unmapped: 'Belum terpetakan',
  }[key] ?? 'Belum terpetakan'
}

function lineRoleFor(key, geometries, featureByAssetId, layerById) {
  const source = geometries.map((geometry) => {
    const owner = featureByAssetId.get(geometry.assetId)
    const layer = layerById.get(geometry.layerId)
    return `${owner?.name || ''} ${owner?.type || ''} `
      + `${layer?.name || ''} ${layer?.sourceFolderPath || ''}`
  }).join(' ').toLowerCase()
  if (key === 'fiber-optic' && source.includes('backbone')) return 'fiber-backbone'
  if (key === 'fiber-optic') return 'fiber-distribution'
  if (key === 'cctv-cable') return 'cctv-cable'
  if (key === 'lan') return 'lan'
  return 'standard'
}

function summarizeNetworkContent(nodes, lineCount, polygonCount) {
  const counts = new Map()
  nodes.forEach((node) => {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  })
  if (lineCount) counts.set('Line', lineCount)
  if (polygonCount) counts.set('Polygon', polygonCount)
  return [...counts].map(([label, count]) => ({ label, count }))
}

function isCoreNode(type = '') {
  return ['core switch', 'junction box', 'otb', 'server', 'nvr', 'router']
    .some((candidate) => type.toLowerCase().includes(candidate))
}

function projectGeometryCoordinates(geometry, bounds) {
  if (geometry.geometryType === 'point') return projectCoordinate(geometry.coordinates, bounds)
  if (geometry.geometryType === 'line_string') {
    return geometry.coordinates.map((position) => projectCoordinate(position, bounds))
  }
  if (geometry.geometryType === 'polygon') {
    return geometry.coordinates.map((ring) => (
      ring.map((position) => projectCoordinate(position, bounds))
    ))
  }
  return null
}

function positionBounds(positions) {
  const valid = positions.filter(validPosition)
  if (!valid.length) return null
  return {
    west: Math.min(...valid.map(([longitude]) => Number(longitude))),
    east: Math.max(...valid.map(([longitude]) => Number(longitude))),
    south: Math.min(...valid.map(([, latitude]) => Number(latitude))),
    north: Math.max(...valid.map(([, latitude]) => Number(latitude))),
  }
}

function projectCoordinate(position, bounds) {
  if (!validPosition(position) || !bounds) return { x: .5, y: .5 }
  const longitudeSpan = Math.max(bounds.east - bounds.west, 0.000001)
  const latitudeSpan = Math.max(bounds.north - bounds.south, 0.000001)
  return {
    x: 0.08 + ((Number(position[0]) - bounds.west) / longitudeSpan) * 0.84,
    y: 0.08 + ((bounds.north - Number(position[1])) / latitudeSpan) * 0.84,
  }
}

function geometryBounds(geometries) {
  const bounds = positionBounds(geometries.flatMap(extractPositions))
  return bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : null
}

function geometryDisplayBounds(geometries) {
  const positions = geometries.flatMap(extractDisplayPositions)
  if (!positions.length) return null
  return {
    minX: Math.min(...positions.map(({ x }) => x)),
    maxX: Math.max(...positions.map(({ x }) => x)),
    minY: Math.min(...positions.map(({ y }) => y)),
    maxY: Math.max(...positions.map(({ y }) => y)),
  }
}

function extractPositions(geometry) {
  if (geometry.geometryType === 'point') return [geometry.coordinates].filter(validPosition)
  if (geometry.geometryType === 'line_string') {
    return (geometry.coordinates ?? []).filter(validPosition)
  }
  if (geometry.geometryType === 'polygon') {
    return (geometry.coordinates ?? []).flat().filter(validPosition)
  }
  return []
}

function extractDisplayPositions(geometry) {
  if (geometry.geometryType === 'point') return [geometry.displayCoordinates].filter(validDisplayPosition)
  if (geometry.geometryType === 'line_string') {
    return (geometry.displayCoordinates ?? []).filter(validDisplayPosition)
  }
  if (geometry.geometryType === 'polygon') {
    return (geometry.displayCoordinates ?? []).flat().filter(validDisplayPosition)
  }
  return []
}

function isRenderableGeometry(geometry) {
  return extractPositions(geometry).length > 0
}

function readProperty(asset, key) {
  return asset?.[key]
    ?? asset?.properties?.semanticMetadata?.[key]
    ?? asset?.properties?.semanticMetadata?.values?.[key]
    ?? asset?.properties?.extendedData?.[key]
    ?? asset?.properties?.[key]
}

function groupBy(records, key) {
  const grouped = new Map()
  records.forEach((record) => {
    grouped.set(record[key], [...(grouped.get(record[key]) ?? []), record])
  })
  return grouped
}

function validPosition(position) {
  if (!Array.isArray(position) || position.length < 2) return false
  const longitude = Number(position[0])
  const latitude = Number(position[1])
  return Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
}

function validDisplayPosition(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.y)
}

function formatName(value) {
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
