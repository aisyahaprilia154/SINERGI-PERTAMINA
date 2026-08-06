import { resolveTopologyReadiness } from '../domain/topology-readiness.js'

const CATEGORY_STYLE = Object.freeze({
  cctv: { color: '#9698f4', softColor: '#f1f1fe', type: 'CCTV', order: 1 },
  'cctv-cable': { color: '#9698f4', softColor: '#f1f1fe', type: 'CCTV cable', order: 2 },
  'fiber-optic': { color: '#70cfb5', softColor: '#edf8f5', type: 'Fiber optic', order: 3 },
  lan: { color: '#aeb8c5', softColor: '#f1f3f5', type: 'LAN', order: 4 },
  infrastructure: { color: '#efc363', softColor: '#fcf6e8', type: 'Infrastructure', order: 5 },
  peripheral: { color: '#a88af3', softColor: '#f5f1fe', type: 'Peripheral', order: 6 },
  unmapped: { color: '#aeb8c5', softColor: '#f1f3f5', type: 'Belum terpetakan', order: 99 },
})

const OPERATIONAL_STATUS_KEYS = Object.freeze([
  'operationalStatus',
  'assetStatus',
  'status',
  'condition',
])

/**
 * Converts one active dataset version into the stable map view model.
 *
 * Persistence assets remain one-per-Placemark. The runtime view intentionally
 * separates Point nodes from line/polygon geometry so a cable or area is not
 * counted as a selectable node. Source coordinates remain immutable; projected
 * display coordinates exist only on the returned view model.
 */
export function adaptActiveDatasetForMap(payload) {
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

  const exportAssets = payload.assets.map((asset) => createOwnerFeature({
    asset,
    layer: layerById.get(asset.layerId),
    geometries: geometriesByOwner.get(asset.id) ?? [],
  }))
  const featureByAssetId = new Map(exportAssets.map((asset) => [asset.id, asset]))

  // KML visibility is presentation state, not proof that an inventory point
  // does not exist. Keep hidden point assets discoverable on the map so a
  // camera/device checked in the source cannot silently disappear from the
  // operational inventory. Lines and polygons still honor source visibility
  // to avoid changing the map surface significantly.
  const assets = exportAssets
    .filter(isDiscoverableMapAsset)
    .map((asset) => createMapNode(asset))
    .filter(Boolean)
  const diagramAssets = exportAssets
    .filter((asset) => isDiscoverableMapAsset(asset) && asset.geometry.length)
    .map(createDiagramAsset)
    .filter(Boolean)
  const assetById = Object.fromEntries(assets.map((asset) => [asset.id, asset]))
  const validNodeIds = new Set(assets.map(({ id }) => id))
  const topologyGraph = confirmedTopologyProjection(payload)
  const topologyReadiness = resolveTopologyReadiness({
    topologyReadiness: payload.topologyReadiness,
    readiness: payload.readiness,
    readinessContract: payload.readinessContract,
    topologyGraph,
  })
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
  const locationGroups = createLocationGroups({
    assets,
    geometries,
    layers,
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

  const counts = {
    networkCount: networks.length,
    layerCount: layers.length,
    assetCount: exportAssets.length,
    assetNodeCount: assets.length,
    pointCount: geometries.filter(({ geometryType }) => geometryType === 'point').length,
    lineCount: geometries.filter(({ geometryType }) => geometryType === 'line_string').length,
    polygonCount: geometries.filter(({ geometryType }) => geometryType === 'polygon').length,
    geometryCount: geometries.length,
    hiddenPlacemarkCount: exportAssets.filter(({ sourceStatus }) => sourceStatus === 'hidden').length,
    hiddenPointAssetCount: exportAssets.filter((asset) => (
      asset.sourceStatus === 'hidden' && hasPointGeometry(asset)
    )).length,
  }

  return {
    activeContext: {
      branchId: payload.datasetVersion.branchId,
      branchName: formatName(payload.datasetVersion.branchId),
      datasetId: payload.datasetVersion.datasetId,
      datasetVersionId: payload.datasetVersion.id,
      datasetName: payload.datasetVersion.versionName,
      version: payload.datasetVersion.versionName,
      sourceFilename: payload.datasetVersion.sourceFilename,
      publishedAt: payload.datasetVersion.activatedAt || payload.activePointer?.activatedAt,
      activePointerRevision: payload.activePointer?.revision,
      topologyReady: topologyReadiness.ready,
      topologyReadiness,
      readinessContract: structuredClone(payload.readinessContract ?? null),
    },
    assets,
    diagramAssets,
    assetById,
    geometries,
    exportAssets,
    networks,
    locationGroups,
    topologyGraph,
    topologySummary: structuredClone(payload.topologySummary ?? {}),
    topologyReadiness,
    readiness: structuredClone(payload.readiness ?? null),
    readinessContract: structuredClone(payload.readinessContract ?? null),
    assetIdentityMap: structuredClone(payload.assetIdentityMap ?? null),
    layers,
    counts,
    renderingSummary: {
      ...structuredClone(payload.renderingSummary ?? {}),
      ...counts,
      assetsWithoutGeometry: exportAssets.filter(({ geometry }) => !geometry.length).length,
    },
    hasRenderableData: geometries.length > 0,
  }
}

function confirmedTopologyProjection(payload) {
  const source = payload.topologyGraph
  const resolver = createFrontendIdentityResolver(payload)
  if (source && Array.isArray(source.nodes) && Array.isArray(source.edges)) {
    const unresolvedNodes = []
    const nodes = source.nodes.flatMap((node) => {
      const originalId = node.canonicalAssetId ?? node.assetId ?? node.id
      const canonicalAssetId = resolver.resolve(originalId)
      if (!canonicalAssetId) {
        unresolvedNodes.push(originalId)
        return []
      }
      return [{
        ...structuredClone(node),
        id: canonicalAssetId,
        assetId: canonicalAssetId,
        canonicalAssetId,
        sourceNodeId: originalId,
      }]
    })
    const nodeIds = new Set(nodes.map(({ id }) => id))
    const unresolvedEdges = []
    const edges = source.edges.flatMap((edge) => {
      if (!isConfirmedRelation(edge)) return []
      const originalSource = edge.sourceAssetId ?? edge.sourceNodeId
      const originalTarget = edge.targetAssetId ?? edge.targetNodeId
      const sourceAssetId = resolver.resolve(originalSource)
      const targetAssetId = resolver.resolve(originalTarget)
      if (!sourceAssetId || !targetAssetId
        || !nodeIds.has(sourceAssetId)
        || !nodeIds.has(targetAssetId)
        || sourceAssetId === targetAssetId) {
        unresolvedEdges.push({
          id: edge.id ?? null,
          sourceAssetId: originalSource,
          targetAssetId: originalTarget,
        })
        return []
      }
      return [{
        ...structuredClone(edge),
        sourceAssetId,
        targetAssetId,
        sourceNodeId: sourceAssetId,
        targetNodeId: targetAssetId,
        canonicalSourceAssetId: sourceAssetId,
        canonicalTargetAssetId: targetAssetId,
      }]
    })
    return {
      ...structuredClone(source),
      nodes,
      edges,
      identityResolution: {
        unresolvedNodeCount: unresolvedNodes.length,
        unresolvedEdgeCount: unresolvedEdges.length,
        unresolvedNodes: unresolvedNodes.slice(0, 25),
        unresolvedEdges: unresolvedEdges.slice(0, 25),
      },
    }
  }
  const nodes = payload.assets.map((asset) => ({
    id: canonicalAssetIdFor(asset),
    assetId: canonicalAssetIdFor(asset),
    canonicalAssetId: canonicalAssetIdFor(asset),
    sourceNodeId: asset.id,
    sourceFeatureId: asset.sourceFeatureId,
  }))
  const validIds = new Set(nodes.map(({ id }) => id))
  const edges = (payload.relations ?? [])
    .filter((relation) => (
      isConfirmedRelation(relation)
      && resolver.resolve(relation.sourceAssetId)
      && resolver.resolve(relation.targetAssetId)
      && validIds.has(resolver.resolve(relation.sourceAssetId))
      && validIds.has(resolver.resolve(relation.targetAssetId))
      && resolver.resolve(relation.sourceAssetId) !== resolver.resolve(relation.targetAssetId)
    ))
    .map((relation) => ({
      ...structuredClone(relation),
      id: relation.id,
      sourceAssetId: resolver.resolve(relation.sourceAssetId),
      targetAssetId: resolver.resolve(relation.targetAssetId),
      sourceNodeId: resolver.resolve(relation.sourceAssetId),
      targetNodeId: resolver.resolve(relation.targetAssetId),
      verificationStatus: 'confirmed',
      relationStatus: 'confirmed',
    }))
  return {
    datasetVersionId: payload.datasetVersion.id,
    nodes,
    edges,
    components: [],
    degreeByNode: {},
    isolatedNodeIds: [],
  }
}

function createFrontendIdentityResolver(payload) {
  const aliases = new Map()
  const register = (alias, canonicalAssetId) => {
    if (!alias || !canonicalAssetId) return
    if (!aliases.has(alias)) aliases.set(alias, canonicalAssetId)
    else if (aliases.get(alias) !== canonicalAssetId) aliases.set(alias, null)
  }
  Object.entries(payload.assetIdentityMap?.aliasToCanonicalAssetId ?? {})
    .forEach(([alias, canonicalAssetId]) => register(alias, canonicalAssetId))
  ;(payload.assetIdentityMap?.items ?? []).forEach((item) => {
    const canonicalAssetId = item.canonicalAssetId
    ;(item.aliasValues ?? Object.values(item.aliases ?? {}).flat())
      .forEach((alias) => register(alias, canonicalAssetId))
  })
  ;(payload.assets ?? []).forEach((asset) => {
    const canonicalAssetId = canonicalAssetIdFor(asset)
    ;[
      canonicalAssetId,
      asset.assetId,
      asset.id,
      asset.sourceFeatureId,
      asset.onboardingIdentity,
      asset.legacyAssetId,
      ...Object.values(asset.identityAliases ?? {}).flat(),
    ].forEach((alias) => register(alias, canonicalAssetId))
  })
  return {
    resolve(value) {
      return aliases.get(value) ?? null
    },
  }
}

function canonicalAssetIdFor(asset) {
  return asset?.canonicalAssetId ?? asset?.assetId ?? asset?.id ?? null
}

function isConfirmedRelation(relation) {
  if (relation.verificationStatus !== undefined) {
    return relation.verificationStatus === 'confirmed'
  }
  return relation.relationStatus === undefined || relation.relationStatus === 'confirmed'
}

export function adaptActiveAssetDetail(payload, mapAsset) {
  const expectedId = mapAsset?.canonicalAssetId ?? mapAsset?.id
  const detailIds = [
    payload?.asset?.canonicalAssetId,
    payload?.asset?.assetId,
    payload?.asset?.id,
    payload?.identity?.canonicalAssetId,
    ...(payload?.identity?.aliasValues ?? []),
  ].filter(Boolean)
  if (!payload?.asset || !expectedId || !detailIds.includes(expectedId)) {
    throw new TypeError('Response detail aset aktif tidak valid.')
  }
  const asset = payload.asset
  const detailOperationalStatus = readOperationalStatus(asset)
  const mapOperationalStatus = readMapOperationalStatus(mapAsset)
  const operationalStatus = detailOperationalStatus.present
    ? detailOperationalStatus
    : mapOperationalStatus
  return {
    ...mapAsset,
    name: asset.name || mapAsset.name,
    category: asset.category || mapAsset.category,
    type: normalizeAssetType(asset.type, asset.category),
    assetType: normalizeAssetType(asset.type, asset.category),
    location: asset.location
      || readProperty(asset, 'location')
      || readProperty(asset, 'description')
      || mapAsset.location,
    status: operationalStatus.value,
    operationalStatus: operationalStatus.value,
    hasOperationalStatusField: operationalStatus.present,
    ip: readProperty(asset, 'ipAddress') || readProperty(asset, 'ip_address') || '—',
    owner: readProperty(asset, 'owner') || 'Tidak tersedia',
    properties: structuredClone(asset.properties ?? {}),
  }
}

function createOwnerFeature({ asset, layer, geometries }) {
  const category = normalizeCategory(asset.category, asset.type, layer)
  const type = normalizeAssetType(asset.type, asset.category || category, layer)
  const operationalStatus = readOperationalStatus(asset)
  const locationGroup = locationGroupFor(layer?.sourceFolderPath)
  const canonicalAssetId = canonicalAssetIdFor(asset)
  return {
    id: canonicalAssetId,
    assetId: canonicalAssetId,
    canonicalAssetId,
    stableAssetId: asset.stableAssetId ?? null,
    onboardingIdentity: asset.onboardingIdentity ?? null,
    legacyAssetId: asset.legacyAssetId ?? asset.assetId ?? null,
    identityStatus: asset.identityStatus ?? 'legacy',
    identityAliases: structuredClone(asset.identityAliases ?? {}),
    sourceNodeId: asset.id,
    sourceFeatureId: asset.sourceFeatureId ?? readProperty(asset, 'sourceFeatureId'),
    name: asset.name || asset.assetId,
    type,
    assetType: type,
    category,
    status: operationalStatus.value,
    operationalStatus: operationalStatus.value,
    hasOperationalStatusField: operationalStatus.present,
    sourceStatus: sourceStatusFor(asset, layer),
    location: asset.location
      || readProperty(asset, 'location')
      || readProperty(asset, 'description')
      || 'Lokasi tidak tersedia',
    datasetVersionId: asset.datasetVersionId,
    layerId: asset.layerId,
    sourceFolderPath: layer?.sourceFolderPath ?? null,
    ...locationGroup,
    networkIds: [],
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

function createDiagramAsset(owner) {
  const positions = owner.geometry.flatMap(extractDisplayPositions)
  if (!positions.length) return null
  const x = positions.reduce((total, position) => total + position.x, 0) / positions.length
  const y = positions.reduce((total, position) => total + position.y, 0) / positions.length
  return {
    ...owner,
    x,
    y,
    renderable: true,
    hasPointGeometry: owner.geometry.some(({ geometryType }) => geometryType === 'point'),
    isCoreNode: isCoreNode(owner.type),
    relationCount: 0,
  }
}

function createSemanticNetworks({
  nodes,
  geometries,
  relations,
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
    group.assetIds.add(node.assetId)
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
    const key = categoryKey(
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
      const bounds = geometryBounds(networkGeometries)
      const displayBounds = geometryDisplayBounds(networkGeometries)
      const subcategories = summarizeNetworkContent(networkNodes, lineCount, polygonCount)
      const locationGroupKeys = [...new Set([
        ...networkNodes.map(({ locationGroupKey }) => locationGroupKey),
        ...networkGeometries.map(({ locationGroupKey }) => locationGroupKey),
      ].filter(Boolean))]
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
        locationGroupKeys,
        lineRole: lineRoleFor(
          group.key,
          networkGeometries,
          featureByAssetId,
          layerById,
        ),
        isDefaultVisible: true,
        ...(bounds ? { bounds } : {}),
        ...(displayBounds ? { displayBounds } : {}),
      }
    })
}

function splitGeometryRecord(geometry) {
  if (!geometry || typeof geometry !== 'object') return []
  if (geometry.geometryType !== 'multi_geometry') {
    return [{
      id: geometry.id,
      sourceGeometryId: geometry.sourceGeometryId ?? geometry.id,
      sourceFeatureId: geometry.sourceFeatureId,
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
      sourceGeometryId: geometry.sourceGeometryId ?? geometry.id,
      sourceFeatureId: geometry.sourceFeatureId,
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
  const locationGroup = locationGroupFor(geometry.layer?.sourceFolderPath)
  const canonicalAssetId = canonicalAssetIdFor(owner)
  return {
    id: geometry.id,
    sourceGeometryId: geometry.sourceGeometryId,
    sourceFeatureId: geometry.sourceFeatureId,
    ...(Number.isInteger(geometry.geometryPartIndex)
      ? { geometryPartIndex: geometry.geometryPartIndex }
      : {}),
    ...(canonicalAssetId ? {
      assetId: canonicalAssetId,
      canonicalAssetId,
      stableAssetId: owner?.stableAssetId ?? null,
      legacyAssetId: owner?.legacyAssetId ?? owner?.assetId ?? null,
    } : {}),
    sourceNodeId: geometry.assetNodeId,
    geometryType: geometry.geometryType,
    coordinates: structuredClone(geometry.coordinates),
    displayCoordinates: projectGeometryCoordinates(geometry, bounds),
    layerId: owner?.layerId ?? geometry.layer?.id ?? null,
    sourceFolderPath: geometry.layer?.sourceFolderPath ?? null,
    ...locationGroup,
    category,
    sourceStatus: geometry.sourceStatus,
    ...(geometry.altitudeMode ? { altitudeMode: geometry.altitudeMode } : {}),
    sourceGeometry: structuredClone(geometry.sourceGeometry),
  }
}

function createLocationGroups({ assets, geometries, layers }) {
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]))
  const groups = new Map()
  const ensureGroup = ({ locationGroupKey: key, locationGroupName: name }, layerId) => {
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name,
        assetIds: new Set(),
        geometryIds: new Set(),
        positions: [],
        order: layerOrder.get(layerId) ?? Number.MAX_SAFE_INTEGER,
      })
    }
    const group = groups.get(key)
    group.order = Math.min(group.order, layerOrder.get(layerId) ?? Number.MAX_SAFE_INTEGER)
    return group
  }

  assets.forEach((asset) => {
    ensureGroup(asset, asset.layerId).assetIds.add(asset.id)
  })
  geometries.forEach((geometry) => {
    const group = ensureGroup(geometry, geometry.layerId)
    group.geometryIds.add(geometry.id)
    group.positions.push(...extractPositions(geometry))
  })

  return [...groups.values()]
    .sort((left, right) => left.order - right.order
      || left.name.localeCompare(right.name, 'id'))
    .map((group) => {
      const bounds = positionBounds(group.positions)
      return {
        key: group.key,
        name: group.name,
        assetIds: [...group.assetIds],
        geometryIds: [...group.geometryIds],
        bounds: bounds
          ? [bounds.west, bounds.south, bounds.east, bounds.north]
          : null,
      }
    })
}

export function locationGroupFor(sourceFolderPath) {
  const segments = String(sourceFolderPath ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const rjbtIndex = segments.findIndex((segment) => segment.toUpperCase() === 'RJBT')
  const name = rjbtIndex >= 0 ? segments[rjbtIndex + 1] : null
  if (!name) {
    return {
      locationGroupKey: 'lainnya',
      locationGroupName: 'Lainnya',
    }
  }
  const key = name.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return {
    locationGroupKey: key || 'lainnya',
    locationGroupName: name,
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
    }))
    .sort((left, right) => left.displayOrder - right.displayOrder
      || left.name.localeCompare(right.name, 'id'))
  const layerById = new Map(normalized.map((layer) => [layer.id, layer]))
  return normalized.map((layer) => ({
    ...layer,
    defaultVisible: hasVisibleLayerAncestry(layer, layerById),
  }))
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

function isDiscoverableMapAsset(asset) {
  return asset?.sourceStatus === 'visible' || hasPointGeometry(asset)
}

function hasPointGeometry(asset) {
  return asset?.geometry?.some(({ geometryType, coordinates }) => (
    geometryType === 'point' && validPosition(coordinates)
  )) === true
}

function readMapOperationalStatus(asset) {
  if (typeof asset?.hasOperationalStatusField === 'boolean') {
    return {
      present: asset.hasOperationalStatusField,
      value: normalizeOperationalStatus(asset.operationalStatus ?? asset.status),
    }
  }
  return readOperationalStatus(asset)
}

function readOperationalStatus(asset) {
  const containers = [
    asset,
    asset?.properties?.semanticMetadata,
    asset?.properties?.semanticMetadata?.values,
    asset?.properties?.extendedData,
    asset?.properties,
  ]
  for (const key of OPERATIONAL_STATUS_KEYS) {
    for (const container of containers) {
      const entry = findOwnProperty(container, key)
      if (entry.found) {
        return { present: true, value: normalizeOperationalStatus(entry.value) }
      }
    }
  }
  return { present: false, value: null }
}

function findOwnProperty(container, expectedKey) {
  if (!container || typeof container !== 'object') return { found: false, value: null }
  const key = Object.keys(container).find((candidate) => (
    candidate.toLocaleLowerCase('id') === expectedKey.toLocaleLowerCase('id')
  ))
  return key === undefined
    ? { found: false, value: null }
    : { found: true, value: container[key] }
}

function normalizeOperationalStatus(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
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
