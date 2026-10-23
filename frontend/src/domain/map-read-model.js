import {searchMatchScore} from './search-normalization.js'
import {formatAssetTypeLabel} from './asset-type-label.js'
import {locationGroupFor,adaptActiveDatasetForMap} from '../adapters/active-dataset-map-adapter.js'
import {parseMapUrlState,serializeMapUrlState} from './map-selection.js'
export {parseMapUrlState,serializeMapUrlState,createNetworkSelectionState} from './map-selection.js'
export {buildExplicitRelationGraph,getConnectedAssets} from './map-network-tracing.js'

export function isPoleLikeAsset(asset) {
  return /\b(tiang|pole|pylon)\b/i.test(
    `${asset?.type ?? ''} ${asset?.category ?? ''} ${asset?.name ?? ''}`,
  )
}

export function readRequestedDatasetContext(search = '', storedDatasetId = null) {
  const query = new URLSearchParams(search)
  return {
    datasetId: query.get('datasetId')
      || storedDatasetId
      || 'dataset-semarang',
    siteId: query.get('siteId') || null,
  }
}

export function stableUrlAssetId(asset) {
  return asset?.stableAssetId
    ?? asset?.assetId
    ?? asset?.canonicalAssetId
    ?? asset?.id
    ?? null
}

export function findAssetMatches(assets, query, limit = 8) {
  const normalizedQuery = String(query ?? '').trim()
  if (!normalizedQuery.replace(/[^\p{L}\p{N}]/gu, '').length) return []

  return assets
    .map((asset, index) => {
      const fields = [
        asset.id,
        asset.assetId,
        asset.canonicalAssetId,
        asset.name,
        asset.sourceName,
        asset.location,
        asset.locationGroupName,
        asset.locationGroupKey,
        asset.hostname,
        asset.type,
        asset.category,
        asset.sourceFolderPath,
      ]
      const score = searchMatchScore(fields, normalizedQuery)
      if (!score) return null
      return {
        asset,
        index,
        score,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.score - left.score
      || String(left.asset.name || left.asset.id).localeCompare(
        String(right.asset.name || right.asset.id),
        'id',
      )
      || left.index - right.index
    ))
    .slice(0, limit)
    .map(({ asset }) => asset)
}

export function searchResultTypeLabel(asset) {
  if (isJunctionBoxAsset(asset)) return 'Junction Box'
  const source = `${asset?.type || ''} ${asset?.assetType || ''} ${asset?.name || ''}`.toLocaleLowerCase('id')
  if (/\btiang\b|\bpole\b|\bpylon\b/.test(source)) return 'Jaringan Infrastruktur'
  return formatAssetTypeLabel(asset)
}

export function formatContextName(value) {
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function selectLocationGroup(search, locationGroups = []) {
  const requested = new URLSearchParams(search).get('area')
  return locationGroups.find(({ key }) => key === requested) ?? locationGroups[0] ?? null
}

export function displayAssetName(asset) {
  return String(asset?.name || '').trim() || 'Aset tanpa nama'
}

/**
 * Returns a small, explainable set of device targets for a manual relation.
 * The list is intentionally local to the selected area and prefers a nearby
 * junction box for cameras, without changing any KML geometry or graph data.
 */

export function buildRelationOptions({
  sourceAsset,
  assets = [],
  connectedAssets = [],
  locationKey = null,
  limit = 8,
} = {}) {
  if (!sourceAsset?.id) return []
  const connectedIds = new Set(connectedAssets.map(({ asset }) => asset?.id).filter(Boolean))
  const sourceLocation = sourceAsset.locationGroupKey || locationKey
  return assets
    .filter((candidate) => candidate?.id && candidate.id !== sourceAsset.id)
    .filter((candidate) => !connectedIds.has(candidate.id))
    .filter((candidate) => isRelationDevice(candidate))
    .filter((candidate) => (
      !sourceLocation
      || !candidate.locationGroupKey
      || candidate.locationGroupKey === sourceLocation
    ))
    .filter((candidate) => validCoordinate(candidate.coordinate))
    .map((candidate) => {
      const distanceMeters = distanceBetweenCoordinates(
        sourceAsset.coordinate,
        candidate.coordinate,
      )
      const preferredJunction = isCameraAsset(sourceAsset) && isJunctionBoxAsset(candidate)
      return {
        asset: candidate,
        distanceMeters,
        preferredJunction,
        reason: preferredJunction
          ? 'Junction box terdekat'
          : `${Math.round(distanceMeters).toLocaleString('id-ID')} m dari aset ini`,
      }
    })
    .sort((left, right) => (
      Number(right.preferredJunction) - Number(left.preferredJunction)
      || left.distanceMeters - right.distanceMeters
      || displayAssetName(left.asset).localeCompare(displayAssetName(right.asset), 'id')
    ))
    .slice(0, Math.max(1, limit))
}

export function isRelationDevice(asset) {
  const source = `${asset?.type || ''} ${asset?.category || ''} ${asset?.objectRole || ''}`.toLocaleLowerCase('id')
  return !/cable|line|string|path|polygon|area|jalur/.test(source)
}

export function isCameraAsset(asset) {
  return /cctv|camera|kamera/.test(
    `${asset?.type || ''} ${asset?.category || ''}`.toLocaleLowerCase('id'),
  )
}

export function isJunctionBoxAsset(asset) {
  return /junction\s*box|\bjb\b|junction/.test(
    `${asset?.type || ''} ${asset?.category || ''} ${asset?.name || ''}`.toLocaleLowerCase('id'),
  )
}

export function validCoordinate(coordinate) {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]))
}

export function distanceBetweenCoordinates(left, right) {
  if (!validCoordinate(left) || !validCoordinate(right)) return Number.POSITIVE_INFINITY
  const earthRadiusMeters = 6371008.8
  const toRadians = (value) => Number(value) * Math.PI / 180
  const latitudeDelta = toRadians(Number(right[1]) - Number(left[1]))
  const longitudeDelta = toRadians(Number(right[0]) - Number(left[0]))
  const leftLatitude = toRadians(left[1])
  const rightLatitude = toRadians(right[1])
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

export function summarizeMapTopology({
  assets = [],
  topologyGraph = {},
  datasetTopologySummary = {},
} = {}) {
  const connectedAssetIds = new Set((topologyGraph.edges ?? []).flatMap((edge) => [
    edge.sourceAssetId ?? edge.sourceNodeId,
    edge.targetAssetId ?? edge.targetNodeId,
  ].filter(Boolean)))
  return {
    confirmedConnectionCount: (topologyGraph.edges ?? []).length,
    pendingConnectionCount: Number(datasetTopologySummary.candidateCount || 0)
      + Number(datasetTopologySummary.ambiguousCount || 0),
    isolatedAssetCount: assets.filter(({ id }) => !connectedAssetIds.has(id)).length,
    pendingScope: 'dataset',
  }
}

export function scopeMapData({
  selectedArea,
  assets,
  diagramAssets,
  geometries,
  exportAssets,
  networks,
  topologyGraph,
  mountingRelations = [],
  mountingCandidates = [],
  mountingOptions = [],
  poleGroups = [],
}) {
  const areaKey = selectedArea?.key
  const scopedAssets = areaKey
    ? assets.filter(({ locationGroupKey }) => locationGroupKey === areaKey)
    : [...assets]
  const scopedGeometries = areaKey
    ? geometries.filter(({ locationGroupKey }) => locationGroupKey === areaKey)
    : [...geometries]
  const scopedAssetIds = new Set(scopedAssets.map(({ id }) => id))
  const scopedGeometryIds = new Set(scopedGeometries.map(({ id }) => id))
  const scopedMountingRelations = mountingRelations.filter((relation) => (
    scopedAssetIds.has(relation.sourceAssetId)
      && scopedAssetIds.has(relation.targetAssetId)
  ))
  const scopedMountingCandidates = mountingCandidates.filter((candidate) => (
    scopedAssetIds.has(candidate.assetId)
      && scopedAssetIds.has(candidate.targetAssetId)
  ))
  const scopedMountingOptions = mountingOptions.filter((option) => (
    scopedAssetIds.has(option.assetId)
      && scopedAssetIds.has(option.targetAssetId)
  ))
  const mountingRelationsByHostId = new Map()
  scopedMountingRelations.forEach((relation) => {
    if (!mountingRelationsByHostId.has(relation.targetAssetId)) {
      mountingRelationsByHostId.set(relation.targetAssetId, [])
    }
    mountingRelationsByHostId.get(relation.targetAssetId).push(relation)
  })
  const scopedPoleGroups = poleGroups
    .map((group) => {
      const assetIds = group.assetIds.filter((assetId) => scopedAssetIds.has(assetId))
      return {
        ...group,
        assetIds,
        assets: group.assets.filter((asset) => scopedAssetIds.has(asset.id)),
        relations: mountingRelationsByHostId.get(group.poleAssetId) ?? [],
        count: assetIds.length,
        childCount: assetIds.filter((assetId) => assetId !== group.poleAssetId).length,
      }
    })
    .filter((group) => (
      group.assetIds.includes(group.poleAssetId) && group.assetIds.length > 1
    ))
  const edges = (topologyGraph.edges ?? []).filter((edge) => {
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    return scopedAssetIds.has(sourceId) && scopedAssetIds.has(targetId)
  })
  const degreeByNode = Object.fromEntries([...scopedAssetIds].map((assetId) => [assetId, 0]))
  edges.forEach((edge) => {
    const sourceId = edge.sourceAssetId ?? edge.sourceNodeId
    const targetId = edge.targetAssetId ?? edge.targetNodeId
    degreeByNode[sourceId] = (degreeByNode[sourceId] ?? 0) + 1
    degreeByNode[targetId] = (degreeByNode[targetId] ?? 0) + 1
  })
  const isolatedNodeIds = [...scopedAssetIds].filter((assetId) => !degreeByNode[assetId])
  const scopedNetworks = networks.map((network) => {
    const nodeIds = network.nodeIds.filter((id) => scopedAssetIds.has(id))
    const geometryIds = network.geometryIds.filter((id) => scopedGeometryIds.has(id))
    const relations = (network.relations ?? []).filter((relation) => (
      scopedAssetIds.has(relation.sourceAssetId)
      && scopedAssetIds.has(relation.targetAssetId)
    ))
    const geometryIdSet = new Set(geometryIds)
    const networkGeometries = scopedGeometries.filter(({ id }) => geometryIdSet.has(id))
    const geometryAssetIds = networkGeometries
      .map(({ assetId }) => assetId)
      .filter(Boolean)
    const assetIds = [...new Set([...nodeIds, ...geometryAssetIds])]
    const relationAssetIds = new Set(relations.flatMap(({ sourceAssetId, targetAssetId }) => (
      [sourceAssetId, targetAssetId]
    )))
    return {
      ...network,
      nodeIds,
      geometryIds,
      geometryAssetIds,
      assetIds,
      relations,
      relationIds: relations.map(({ id }) => id),
      edges: relations.map(({ sourceAssetId, targetAssetId }) => [sourceAssetId, targetAssetId]),
      confirmedConnectionCount: relations.length,
      isolatedAssetCount: nodeIds.filter((assetId) => !relationAssetIds.has(assetId)).length,
      assetCount: assetIds.length,
      nodeCount: nodeIds.length,
      lineCount: networkGeometries.filter(
        ({ geometryType }) => geometryType === 'line_string',
      ).length,
      polygonCount: networkGeometries.filter(
        ({ geometryType }) => geometryType === 'polygon',
      ).length,
      ...(selectedArea?.bounds ? { bounds: selectedArea.bounds } : {}),
    }
  }).filter((network) => network.nodeIds.length || network.geometryIds.length)
  const nodes = (topologyGraph.nodes ?? []).filter((node) => (
    scopedAssetIds.has(node.id) || scopedAssetIds.has(node.assetId)
  ))
  const scopedExportAssetIds = new Set([
    ...scopedAssetIds,
    ...scopedGeometries.map(({ assetId }) => assetId).filter(Boolean),
  ])
  return {
    assets: scopedAssets,
    assetById: Object.fromEntries(scopedAssets.map((asset) => [asset.id, asset])),
    diagramAssets: diagramAssets.filter((asset) => (
      asset.locationGroupKey === areaKey || !areaKey
    )),
    geometries: scopedGeometries,
    exportAssets: exportAssets.filter(({ id }) => scopedExportAssetIds.has(id)),
    mountingRelations: scopedMountingRelations,
    mountingCandidates: scopedMountingCandidates,
    mountingOptions: scopedMountingOptions,
    poleGroups: scopedPoleGroups,
    networks: scopedNetworks,
    topologyGraph: {
      ...topologyGraph,
      nodes,
      edges,
      degreeByNode,
      isolatedNodeIds,
    },
    counts: {
      networkCount: scopedNetworks.length,
      layerCount: new Set([
        ...scopedAssets.map(({ layerId }) => layerId),
        ...scopedGeometries.map(({ layerId }) => layerId),
      ].filter(Boolean)).size,
      assetCount: scopedExportAssetIds.size,
      assetNodeCount: scopedAssets.length,
      pointCount: scopedGeometries.filter(({ geometryType }) => geometryType === 'point').length,
      lineCount: scopedGeometries.filter(
        ({ geometryType }) => geometryType === 'line_string',
      ).length,
      polygonCount: scopedGeometries.filter(
        ({ geometryType }) => geometryType === 'polygon',
      ).length,
      geometryCount: scopedGeometries.length,
      poleGroupCount: scopedPoleGroups.length,
    },
  }
}

export function overlayMatchesArea(overlay, selectedArea) {
  if (!selectedArea) return true
  return locationGroupFor(overlay.sourceFolderPath).locationGroupKey === selectedArea.key
}

export function networkMatchesPreset(network, preset) {
  if (preset.startsWith('custom:')) return network.categoryKey === preset
  const source = `${network.category ?? ''} ${network.type ?? ''} ${network.name ?? ''}`.toLowerCase()
  if (preset === 'cctv') return /cctv|camera|kamera|nvr|junction/.test(source)
  if (preset === 'fiber') return /fiber|fibre|\bfo\b|otb/.test(source)
  if (preset === 'power') return /power|pln|listrik/.test(source)
  if (preset === 'lan') return /\blan\b|utp/.test(source)
  if (preset === 'infrastructure') {
    return /infrastructure|switch|server|router|rack|peripheral|printer|access point/.test(source)
  }
  return true
}

export function mapSelectionOptions({ networks, assets }) {
  const defaultNetworkIds = networks.filter(network => network.isDefaultVisible).map(network => network.id)
  if (!defaultNetworkIds.length && networks[0]) defaultNetworkIds.push(networks[0].id)
  return { networkIds: networks.map(network => network.id), assetIds: assets.map(asset => asset.id), assetAliases: Object.fromEntries(assets.map(asset => [stableUrlAssetId(asset), asset.id])), defaultNetworkIds }
}
export function mapSelectionQuery(search, { activeContext, selectedArea, assetById, selection, urlState }) {
  const query = new URLSearchParams(serializeMapUrlState(search, { datasetId: activeContext.datasetId, siteId: activeContext.siteId, selectedNetworkIds: selection.selectedNetworkIds, selectedAssetId: stableUrlAssetId(assetById[selection.selectedAssetId]), networkFamily: urlState.networkFamily, category: urlState.category, assetType: urlState.assetType, topologyStatus: urlState.topologyStatus }))
  if (selectedArea?.key) query.set('area', selectedArea.key)
  return query
}
export function createMapReadModel(payload, search = '') {
  const all = adaptActiveDatasetForMap(payload), selectedArea = selectLocationGroup(search, all.locationGroups)
  const scoped = scopeMapData({ ...all, selectedArea })
  const selectionOptions = mapSelectionOptions(scoped)
  return { ...scoped, all, selectedArea, selectionOptions, urlState: parseMapUrlState(search, selectionOptions), activeContext: all.activeContext, locationGroups: all.locationGroups, renderingSummary: all.renderingSummary, topologyReadiness: all.topologyReadiness, topologySummary: summarizeMapTopology({ assets: scoped.assets, topologyGraph: scoped.topologyGraph, datasetTopologySummary: all.topologySummary }), overlays: (all.overlays || []).filter(overlay => overlay.valid && overlay.resourceResolutionStatus === 'resolved' && overlay.resourceUrl && overlayMatchesArea(overlay, selectedArea)) }
}

export function getNetworkSubcategories(network, assetById) {
  const counts = new Map()
  network.nodeIds.forEach((assetId) => {
    const asset = assetById[assetId]
    if (!asset) return
    const label = normalizeSubcategory(formatAssetTypeLabel(asset), network.type)
    counts.set(label, (counts.get(label) || 0) + 1)
  })
  return [...counts].map(([label, count]) => ({ label, count }))
}

function normalizeSubcategory(type, networkType) {
  const normalizedType = String(type ?? '').toLowerCase()
  const normalizedNetwork = String(networkType ?? '').toLowerCase()
  if (normalizedType === 'junction box' && normalizedNetwork === 'cctv') return 'Junction Box CCTV'
  if (normalizedType.includes('switch')) return 'Switch'
  if (normalizedType === 'access point') return 'Access Point'
  return type
}

export function formatDatasetCounts(counts) {
  return `${Number(counts.networkCount) || 0} jaringan, `
    + `${Number(counts.layerCount) || 0} layer, `
    + `${Number(counts.assetNodeCount) || 0} node, `
    + `${Number(counts.lineCount) || 0} line, `
    + `${Number(counts.polygonCount) || 0} polygon`
}
