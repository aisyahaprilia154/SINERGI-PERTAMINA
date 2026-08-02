import {
  deriveAssetDisplayName,
  deriveAssetShortLabel,
  truncateAssetLabel,
} from '../../domain/asset-display-name.js'
import { isUserConfirmedRelation } from '../../domain/relation-readiness.js'

const DEFAULT_DETAIL_MAX_NODES = 30
const DEFAULT_COMPACT_MAX_NODES = 100

export function buildSchematicGraph({
  assets,
  networks,
  geometries = [],
  topologyGraph = null,
  selectedNetworkIds = [],
  selectedLayerIds = [],
  focusedAssetId = null,
  focusDepth = 1,
  tracePath = [],
  traceRelations = [],
  viewportBounds = null,
  scope = 'auto',
  maxNodes = DEFAULT_DETAIL_MAX_NODES,
  compactMaxNodes = DEFAULT_COMPACT_MAX_NODES,
  includePendingRelations = false,
  includeIsolatedNodes = false,
}) {
  const diagramScope = normalizeDiagramScope(scope)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const virtualNodeById = new Map((topologyGraph?.virtualJunctions || [])
    .map((junction) => [junction.id, junction]))
  const networkById = new Map(networks.map((network) => [network.id, network]))
  const selectedIds = new Set(selectedNetworkIds)
  const topologyEdges = collectTopologyEdges(topologyGraph, networks, {
    includePendingRelations,
  })
  const hasTopology = Array.isArray(topologyGraph?.edges)

  if (diagramScope === 'overview') {
    if (!topologyEdges.length) {
      const overviewNodeCount = new Set(networks.flatMap(
        (network) => network.nodeIds ?? [],
      )).size
      return relationUnavailableGraph('overview', overviewNodeCount)
    }
    return buildOverviewGraph({
      assets,
      networks,
      geometries,
      topologyEdges,
      includeUnconnectedNetworks: includePendingRelations,
    })
  }

  let mode = 'network'
  let anchorAssetId = null
  let nodeIds = []
  let sourceEdges = []

  if (diagramScope === 'trace' && tracePath.length < 2) {
    return emptyGraph(
      'trace',
      'Jalur terpilih belum tersedia. Jalankan tracing terlebih dahulu.',
    )
  }

  if ((diagramScope === 'auto' || diagramScope === 'trace') && tracePath.length > 1) {
    mode = 'trace'
    anchorAssetId = tracePath[0]
    nodeIds = tracePath.filter((assetId) => assetById.has(assetId))
    sourceEdges = buildTraceEdges(tracePath, traceRelations, networks)
  } else if (diagramScope === 'full-map') {
    mode = 'full-map'
    nodeIds = uniqueIds(hasTopology
      ? topologyGraph.nodes.map(({ id }) => id)
      : networks.flatMap((network) => network.nodeIds || []))
      .filter((assetId) => assetById.has(assetId))
    sourceEdges = topologyEdges
  } else if (diagramScope === 'component'
    && focusedAssetId && assetById.has(focusedAssetId)) {
    mode = 'component'
    anchorAssetId = focusedAssetId
    const componentResult = collectFocusScope(
      focusedAssetId,
      topologyEdges,
      Number.POSITIVE_INFINITY,
    )
    nodeIds = componentResult.nodeIds.filter((assetId) => assetById.has(assetId))
    sourceEdges = componentResult.edges
  } else if ((diagramScope === 'auto' || diagramScope === 'focus')
    && focusedAssetId && assetById.has(focusedAssetId)) {
    mode = 'focus'
    anchorAssetId = focusedAssetId
    const focusResult = collectFocusScope(
      focusedAssetId,
      topologyEdges,
      Math.max(1, Math.min(2, focusDepth)),
    )
    nodeIds = focusResult.nodeIds.filter((assetId) => assetById.has(assetId))
    sourceEdges = focusResult.edges
  } else if (diagramScope === 'viewport') {
    mode = 'viewport'
    nodeIds = assets
      .filter((asset) => pointWithinGeographicBounds(asset, viewportBounds))
      .map(({ id }) => id)
    sourceEdges = topologyEdges
  } else if (diagramScope === 'layer') {
    mode = 'layer'
    const layerIds = new Set(selectedLayerIds)
    nodeIds = assets
      .filter((asset) => layerIds.has(asset.layerId))
      .map(({ id }) => id)
    sourceEdges = topologyEdges
  } else {
    mode = 'network'
    const selectedNetworks = networks.filter((network) => selectedIds.has(network.id))
    const selectedTopologyEdges = hasTopology
      ? topologyEdges.filter(({ networkId }) => selectedIds.has(networkId))
      : selectedNetworks.flatMap((network) => networkFallbackEdges(network))
    nodeIds = uniqueIds([
      ...selectedNetworks.flatMap((network) => network.nodeIds || []),
      ...selectedTopologyEdges.flatMap(({ sourceId, targetId }) => [sourceId, targetId]),
    ]).filter((assetId) => assetById.has(assetId))
    sourceEdges = selectedTopologyEdges
  }

  const expandedVirtualGraph = diagramScope === 'trace'
    ? { nodeIds, edges: sourceEdges }
    : expandVirtualJunctionPaths({
      nodeIds,
      edges: sourceEdges,
      topologyGraph,
      virtualNodeById,
    })
  nodeIds = uniqueIds(expandedVirtualGraph.nodeIds)
  sourceEdges = expandedVirtualGraph.edges
  const includedIds = new Set(nodeIds)
  const scopedEdges = deduplicateEdges(sourceEdges)
    .filter((edge) => (
      isUserConfirmedRelation(edge)
      || (includePendingRelations && edge.relationStatus === 'inferred_pending')
    ))
    .filter((edge) => includedIds.has(edge.sourceId) && includedIds.has(edge.targetId))
  const representedGeometryIds = collectScopeGeometryIds({
    mode,
    geometries,
    networks,
    selectedNetworkIds,
    selectedLayerIds,
    viewportBounds,
    scopedEdges,
  })
  if (nodeIds.length && !scopedEdges.length && includeIsolatedNodes) {
    const inventoryNodes = nodeIds
      .filter((nodeId) => assetById.has(nodeId))
      .map((assetId) => mapAssetNode(assetById.get(assetId), {
        anchorAssetId: null,
        networks,
        order: null,
      }))
    return {
      status: 'ready',
      mode,
      anchorAssetId: null,
      nodes: inventoryNodes,
      edges: [],
      isDiagnosticPreview: true,
      isInventoryPreview: true,
      pendingEdgeCount: 0,
      nodeCount: inventoryNodes.length,
      representedNodeIds: inventoryNodes.map(({ id }) => id),
      representedGeometryIds,
      pathGeometryIds: [],
      layoutDensity: inventoryNodes.length > maxNodes ? 'compact' : 'detail',
      sourceBounds: getSourceDisplayBounds(inventoryNodes),
      title: getDiagramTitle(mode, inventoryNodes, networkById, selectedIds, focusDepth),
    }
  }
  if (!nodeIds.length || !scopedEdges.length) {
    return relationUnavailableGraph(mode, nodeIds.length)
  }
  const connectedNodeIds = new Set(scopedEdges.flatMap(({ sourceId, targetId }) => (
    [sourceId, targetId]
  )))
  nodeIds = nodeIds.filter((nodeId) => (
    connectedNodeIds.has(nodeId)
    || (includeIsolatedNodes && assetById.has(nodeId))
  ))
  anchorAssetId ||= chooseCoreAnchor(nodeIds, scopedEdges, assetById)

  if (mode !== 'trace' && nodeIds.length > compactMaxNodes) {
    return {
      status: 'scope-required',
      mode,
      nodeCount: nodeIds.length,
      maxNodes,
      compactMaxNodes,
      message: `${nodeIds.length} aset ditemukan. Pilih cara penyederhanaan diagram.`,
      nodes: [],
      edges: [],
      representedNodeIds: [...nodeIds],
      representedGeometryIds,
      availableActions: [
        'overview-pengapon',
        'current-viewport',
        'selected-network',
        'active-trace',
        'multi-page',
      ],
    }
  }

  const edges = mapSchematicEdges(scopedEdges, networkById)
  const pendingEdgeCount = scopedEdges.filter(({ relationStatus }) => (
    relationStatus === 'inferred_pending'
  )).length
  const nodes = nodeIds.map((assetId, index) => (
    virtualNodeById.has(assetId)
      ? mapVirtualJunction(virtualNodeById.get(assetId), scopedEdges)
      : mapAssetNode(assetById.get(assetId), {
        anchorAssetId,
        networks,
        order: mode === 'trace' ? index : null,
      })
  ))

  return {
    status: 'ready',
    mode,
    anchorAssetId,
    nodes,
    edges,
    isDiagnosticPreview: pendingEdgeCount > 0,
    pendingEdgeCount,
    nodeCount: nodes.length,
    representedNodeIds: [...nodeIds],
    representedGeometryIds,
    pathGeometryIds: uniqueIds(scopedEdges.flatMap(edgeGeometryIds)),
    layoutDensity: nodes.length > maxNodes ? 'compact' : 'detail',
    sourceBounds: getSourceDisplayBounds(nodes),
    title: getDiagramTitle(mode, nodes, networkById, selectedIds, focusDepth),
  }
}

// Preferred public name: the function scopes an existing TopologyGraph and
// never repeats topology inference.
export const buildScopedGraph = buildSchematicGraph

export function segmentSchematicGraph(graph, {
  pageSize = DEFAULT_DETAIL_MAX_NODES,
} = {}) {
  if (graph.status !== 'ready' || !graph.nodes.length) {
    return { status: graph.status, pages: [], pageSize }
  }
  const componentGroups = collectConnectedComponentGroups(graph)
  const chunks = segmentComponentGroups(componentGroups, graph, pageSize)
  const pageCount = chunks.length
  const pages = chunks.map((nodeIds, index) => {
    const included = new Set(nodeIds)
    const pageEdges = graph.edges.filter(({ sourceId, targetId }) => (
      included.has(sourceId) && included.has(targetId)
    ))
    const omittedConnectionCount = graph.edges.filter(({ sourceId, targetId }) => (
      included.has(sourceId) !== included.has(targetId)
    )).length
    const nodes = nodeIds.map((nodeId) => graph.nodes.find(({ id }) => id === nodeId))
    return {
      ...graph,
      mode: 'multi-page',
      title: `${graph.title} · Halaman ${index + 1} dari ${pageCount}`,
      nodes,
      edges: pageEdges,
      nodeCount: nodes.length,
      pageNumber: index + 1,
      pageCount,
      omittedConnectionCount,
      layoutDensity: 'detail',
      sourceBounds: getSourceDisplayBounds(nodes),
    }
  })
  return {
    status: 'ready',
    pageSize,
    pageCount,
    totalNodeCount: graph.nodes.length,
    segmentationStrategy: 'connected-component-then-network',
    indexSummary: {
      connectedComponentCount: componentGroups.length,
      pageCount,
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        title: page.title,
        nodeCount: page.nodeCount,
        edgeCount: page.edges.length,
        omittedConnectionCount: page.omittedConnectionCount,
      })),
    },
    pages,
  }
}

function collectTopologyEdges(topologyGraph, networks, {
  includePendingRelations = false,
} = {}) {
  if (Array.isArray(topologyGraph?.edges)) {
    const sourceEdges = [
      ...topologyGraph.edges.filter(isUserConfirmedRelation),
      ...(includePendingRelations ? topologyGraph.candidateEdges ?? [] : []),
    ]
    return sourceEdges.map((edge, index) => ({
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
      networkId: edge.networkId || null,
      relationType: edge.relationType,
      relationSource: edge.relationSource,
      relationStatus: edge.relationStatus,
      pathGeometryId: edge.pathGeometryId,
      sourceGeometryId: edge.sourceGeometryId,
      sourceGeometryIds: edge.sourceGeometryIds || [],
      distanceMeters: edge.distanceMeters,
      chainage: edge.chainage ? structuredClone(edge.chainage) : undefined,
      topologyEvidence: edge.topologyEvidence
        ? structuredClone(edge.topologyEvidence)
        : undefined,
      order: index,
    }))
  }
  return networks.flatMap((network) => networkFallbackEdges(network))
}

function networkFallbackEdges(network) {
  return (network.relations || [])
    .filter(isUserConfirmedRelation)
    .map((relation, index) => ({
      sourceId: relation.sourceAssetId || relation.sourceNodeId,
      targetId: relation.targetAssetId || relation.targetNodeId,
      networkId: network.id,
      relationType: relation.relationType || 'connected-to',
      relationSource: relation.relationSource || 'explicit',
      relationStatus: relation.relationStatus,
      pathGeometryId: relation.pathGeometryId,
      sourceGeometryId: relation.sourceGeometryId,
      sourceGeometryIds: relation.sourceGeometryIds || [],
      order: index,
    }))
}

function collectFocusScope(focusedAssetId, edges, depthLimit) {
  const adjacency = new Map()
  edges.forEach((edge) => {
    adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) || []), edge])
    adjacency.set(edge.targetId, [...(adjacency.get(edge.targetId) || []), edge])
  })
  const depths = new Map([[focusedAssetId, 0]])
  const queue = [focusedAssetId]
  while (queue.length) {
    const current = queue.shift()
    const depth = depths.get(current)
    if (depth >= depthLimit) continue
    ;(adjacency.get(current) || []).forEach((edge) => {
      const next = edge.sourceId === current ? edge.targetId : edge.sourceId
      if (depths.has(next)) return
      depths.set(next, depth + 1)
      queue.push(next)
    })
  }
  const included = new Set(depths.keys())
  return {
    nodeIds: [...included],
    edges: edges.filter(({ sourceId, targetId }) => (
      included.has(sourceId) && included.has(targetId)
    )),
  }
}

function buildOverviewGraph({
  assets,
  networks,
  geometries,
  topologyEdges,
  includeUnconnectedNetworks = false,
}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]))
  const availableNetworks = networks.filter((network) => (
    includeUnconnectedNetworks
      ? (network.nodeIds?.length || network.geometryIds?.length || network.lineCount)
      : topologyEdges.some((edge) => (
        edge.networkId === network.id
        || (
          (network.nodeIds || []).includes(edge.sourceId)
          && (network.nodeIds || []).includes(edge.targetId)
        )
      ))
  ))
  if (!availableNetworks.length) {
    return emptyGraph('overview', 'Tidak ada jaringan aktif untuk dibuat menjadi overview.')
  }

  const groupByAssetId = new Map()
  availableNetworks.forEach((network) => {
    ;(network.nodeIds || []).forEach((assetId) => {
      if (assetById.has(assetId) && !groupByAssetId.has(assetId)) {
        groupByAssetId.set(assetId, network.id)
      }
    })
  })

  const nodes = availableNetworks.map((network) => {
    const memberIds = (network.nodeIds || [])
      .filter((assetId) => groupByAssetId.get(assetId) === network.id)
    const members = memberIds.map((assetId) => assetById.get(assetId)).filter(Boolean)
    const representedGeometryIds = (network.geometryIds || [])
      .filter((geometryId) => geometryById.has(geometryId))
    const lineCount = representedGeometryIds.filter((geometryId) => (
      geometryById.get(geometryId)?.geometryType === 'line_string'
    )).length
    const networkEdges = topologyEdges.filter((edge) => (
      edge.networkId === network.id
      || (memberIds.includes(edge.sourceId) && memberIds.includes(edge.targetId))
    ))
    const representedNodeIds = uniqueIds([
      ...memberIds,
      ...networkEdges.flatMap(({ sourceId, targetId }) => [sourceId, targetId]),
    ]).filter((nodeId) => assetById.has(nodeId))
    const representedMembers = representedNodeIds
      .map((assetId) => assetById.get(assetId))
      .filter(Boolean)
    const connectedNodeIds = new Set(networkEdges.flatMap(({ sourceId, targetId }) => (
      [sourceId, targetId]
    )))
    const isolatedNodeCount = representedNodeIds.filter(
      (nodeId) => !connectedNodeIds.has(nodeId),
    ).length
    const connectedComponentCount = countGraphComponents(
      representedNodeIds,
      networkEdges,
    )
    const sourcePosition = averageSourcePosition(representedMembers)
      || centerOfDisplayBounds(network.displayBounds)
    return {
      id: `group:${network.id}`,
      assetId: null,
      label: network.name || network.shortName,
      name: network.name || network.shortName,
      shortName: `${representedNodeIds.length} node · ${lineCount} line`,
      type: network.type || 'Jaringan',
      category: categoryForNetwork(network),
      location: `${network.layerCount || network.layerIds?.length || 0} layer · ${networkEdges.length} koneksi`,
      status: '',
      sourcePosition,
      isAnchor: false,
      isConnector: true,
      isGroup: true,
      groupType: 'network-aggregate',
      groupId: network.id,
      memberCount: members.length,
      memberIds,
      ownedNodeCount: members.length,
      nodeCount: representedNodeIds.length,
      lineCount,
      edgeCount: networkEdges.length,
      isolatedNodeCount,
      connectedComponentCount,
      bounds: network.bounds || null,
      representedNodeIds,
      representedGeometryIds,
      detailScopeKey: includeUnconnectedNetworks
        ? networkEdges.length
          ? `preview-network:${network.id}`
          : `preview-inventory-network:${network.id}`
        : `network:${network.id}`,
      order: null,
    }
  }).filter(({ nodeCount, lineCount, representedGeometryIds }) => (
    nodeCount > 0 || lineCount > 0 || representedGeometryIds.length > 0
  ))

  const overviewNodeByNetwork = new Map(nodes.map((node) => [node.groupId, node]))
  const aggregatedEdges = new Map()
  topologyEdges.forEach((edge) => {
    let sourceGroupId = groupByAssetId.get(edge.sourceId)
    let targetGroupId = groupByAssetId.get(edge.targetId)
    const pathGroupId = overviewNodeByNetwork.has(edge.networkId)
      ? edge.networkId
      : null
    if (sourceGroupId && sourceGroupId === targetGroupId
      && pathGroupId && pathGroupId !== sourceGroupId) {
      targetGroupId = pathGroupId
    }
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) return
    const key = [sourceGroupId, targetGroupId].sort().join('|')
    const existing = aggregatedEdges.get(key)
    if (existing) {
      existing.connectionCount += 1
      return
    }
    const sourceGroup = overviewNodeByNetwork.get(sourceGroupId)
    const targetGroup = overviewNodeByNetwork.get(targetGroupId)
    aggregatedEdges.set(key, {
      id: `overview:${key}`,
      sourceId: sourceGroup.id,
      targetId: targetGroup.id,
      networkId: sourceGroupId,
      networkName: 'Koneksi utama antar-jaringan',
      networkColor: networks.find(({ id }) => id === sourceGroupId)?.color || null,
      networkType: 'Overview',
      relationType: 'overview-aggregate',
      relationSource: 'topology-aggregate',
      connectionCount: 1,
      order: aggregatedEdges.size,
    })
  })

  const anchor = [...nodes].sort((left, right) => (
    right.memberCount - left.memberCount || left.id.localeCompare(right.id)
  ))[0]
  const pendingEdgeCount = topologyEdges.filter(({ relationStatus }) => (
    relationStatus === 'inferred_pending'
  )).length
  if (anchor) anchor.isAnchor = true
  return {
    status: 'ready',
    mode: 'overview',
    anchorAssetId: anchor?.id || null,
    nodes,
    edges: [...aggregatedEdges.values()],
    isDiagnosticPreview: pendingEdgeCount > 0,
    pendingEdgeCount,
    nodeCount: nodes.length,
    representedAssetCount: uniqueIds(
      nodes.flatMap((node) => node.representedNodeIds),
    ).length,
    representedNodeIds: uniqueIds(nodes.flatMap((node) => node.representedNodeIds)),
    representedGeometryIds: uniqueIds(
      nodes.flatMap((node) => node.representedGeometryIds),
    ),
    layoutDensity: 'overview',
    sourceBounds: getSourceDisplayBounds(nodes),
    title: 'Overview jaringan Pengapon',
  }
}

function countGraphComponents(nodeIds, edges) {
  if (!nodeIds.length) return 0
  const included = new Set(nodeIds)
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]))
  edges.forEach(({ sourceId, targetId }) => {
    if (!included.has(sourceId) || !included.has(targetId)) return
    adjacency.get(sourceId).push(targetId)
    adjacency.get(targetId).push(sourceId)
  })
  const visited = new Set()
  let componentCount = 0
  nodeIds.forEach((startNodeId) => {
    if (visited.has(startNodeId)) return
    componentCount += 1
    const queue = [startNodeId]
    visited.add(startNodeId)
    while (queue.length) {
      const currentNodeId = queue.shift()
      adjacency.get(currentNodeId).forEach((nextNodeId) => {
        if (visited.has(nextNodeId)) return
        visited.add(nextNodeId)
        queue.push(nextNodeId)
      })
    }
  })
  return componentCount
}

function mapSchematicEdges(edges, networkById) {
  return edges.map((edge, index) => {
    const network = networkById.get(edge.networkId)
    return {
      id: `${edge.networkId || 'relation'}:${edge.sourceId}:${edge.targetId}:${index}`,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      networkId: edge.networkId || null,
      networkName: network?.shortName || network?.name || 'Topologi terkonfirmasi',
      networkColor: network?.color || null,
      networkType: network?.type || 'Relasi',
      relationType: edge.relationType || 'explicit-network-edge',
      relationSource: edge.relationSource || 'explicit',
      relationStatus: edge.relationStatus || 'confirmed',
      pathGeometryId: edge.pathGeometryId,
      sourceGeometryId: edge.sourceGeometryId,
      sourceGeometryIds: edge.sourceGeometryIds || [],
      distanceMeters: edge.distanceMeters,
      chainage: edge.chainage ? structuredClone(edge.chainage) : undefined,
      topologyEvidence: edge.topologyEvidence
        ? structuredClone(edge.topologyEvidence)
        : undefined,
      order: edge.order ?? index,
    }
  })
}

function mapAssetNode(asset, {
  anchorAssetId,
  networks,
  order,
}) {
  return {
    id: asset.id,
    stableId: asset.stableId || asset.id,
    assetId: asset.assetId ?? null,
    sourceName: asset.sourceName || asset.name,
    sourceFolderPath: asset.sourceFolderPath || null,
    displayName: asset.displayName || deriveAssetDisplayName(asset),
    shortLabel: asset.shortLabel || deriveAssetShortLabel(asset),
    name: asset.displayName || deriveAssetDisplayName(asset),
    shortName: truncateAssetLabel(
      asset.displayName || deriveAssetDisplayName(asset),
      30,
    ),
    type: asset.type,
    category: resolveCategory(asset, networks),
    location: asset.location || '',
    ip: normalizeIp(asset.ip),
    status: asset.status || '',
    hasIssue: asset.hasIssue === true || Number(asset.issueCount) > 0,
    networkIds: [...(asset.networkIds || [])],
    sourcePosition: getSourceDisplayPosition(asset),
    isAnchor: asset.id === anchorAssetId,
    isConnector: isConnectorType(asset.type),
    isCoreNode: /\bcore\s*switch\b/i.test(asset.type || '')
      || asset.isCoreNode === true,
    isVirtual: false,
    order,
  }
}

function mapVirtualJunction(junction, edges) {
  const edge = edges.find(({ sourceId, targetId }) => (
    sourceId === junction.id || targetId === junction.id
  ))
  return {
    id: junction.id,
    stableId: junction.id,
    assetId: null,
    sourceName: '',
    sourceFolderPath: null,
    displayName: 'Junction topologi internal',
    shortLabel: '',
    name: 'Junction topologi internal',
    shortName: '',
    type: 'Virtual junction',
    category: categoryFromNetworkId(edge?.networkId),
    location: 'Titik percabangan internal dari TopologyGraph',
    ip: '',
    status: '',
    hasIssue: false,
    networkIds: [edge?.networkId].filter(Boolean),
    sourcePosition: null,
    isAnchor: false,
    isConnector: true,
    isCoreNode: false,
    isVirtual: true,
    order: null,
  }
}

function expandVirtualJunctionPaths({
  nodeIds,
  edges,
  topologyGraph,
  virtualNodeById,
}) {
  if (!virtualNodeById.size || !Array.isArray(topologyGraph?.internalEdges)) {
    return { nodeIds, edges }
  }
  const inventoryIds = new Set(nodeIds)
  const expandableEdges = edges.filter(({ relationSource }) => (
    relationSource === 'inferred_intersection'
  ))
  if (!expandableEdges.length) return { nodeIds, edges }

  const geometryRelation = new Map()
  expandableEdges.forEach((edge) => {
    edgeGeometryIds(edge).forEach((geometryId) => {
      if (!geometryRelation.has(geometryId)) {
        geometryRelation.set(geometryId, {
          networkId: edge.networkId || null,
          relationStatus: edge.relationStatus,
        })
      }
    })
  })
  const candidates = topologyGraph.internalEdges
    .filter((edge) => geometryRelation.has(edge.sourceGeometryId))
    .filter((edge) => (
      (inventoryIds.has(edge.sourceNodeId) || virtualNodeById.has(edge.sourceNodeId))
      && (inventoryIds.has(edge.targetNodeId) || virtualNodeById.has(edge.targetNodeId))
    ))
    .map((edge, index) => ({
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
      networkId: geometryRelation.get(edge.sourceGeometryId).networkId,
      relationType: 'line-intersection',
      relationSource: edge.relationSource || 'inferred_intersection',
      relationStatus: geometryRelation.get(edge.sourceGeometryId).relationStatus,
      sourceGeometryId: edge.sourceGeometryId,
      sourceGeometryIds: [edge.sourceGeometryId].filter(Boolean),
      order: index,
    }))
  const retainedVirtualIds = connectedVirtualIds(candidates, inventoryIds, virtualNodeById)
  const expandedEdges = candidates.filter(({ sourceId, targetId }) => (
    (inventoryIds.has(sourceId) || retainedVirtualIds.has(sourceId))
    && (inventoryIds.has(targetId) || retainedVirtualIds.has(targetId))
  ))
  if (!expandedEdges.length) return { nodeIds, edges }

  return {
    nodeIds: [...nodeIds, ...retainedVirtualIds],
    edges: [
      ...edges.filter(({ relationSource }) => relationSource !== 'inferred_intersection'),
      ...expandedEdges,
    ],
  }
}

function connectedVirtualIds(edges, inventoryIds, virtualNodeById) {
  const adjacency = new Map()
  edges.forEach(({ sourceId, targetId }) => {
    adjacency.set(sourceId, [...(adjacency.get(sourceId) || []), targetId])
    adjacency.set(targetId, [...(adjacency.get(targetId) || []), sourceId])
  })
  const queue = [...inventoryIds].filter((id) => adjacency.has(id))
  const visited = new Set(queue)
  while (queue.length) {
    const current = queue.shift()
    ;(adjacency.get(current) || []).forEach((neighbor) => {
      if (visited.has(neighbor)) return
      visited.add(neighbor)
      queue.push(neighbor)
    })
  }
  return new Set([...visited].filter((id) => virtualNodeById.has(id)))
}

function categoryFromNetworkId(networkId = '') {
  if (networkId.includes('cctv')) return 'cctv'
  if (networkId.includes('fiber')) return 'fiber-optic'
  if (networkId.includes('lan')) return 'lan'
  if (networkId.includes('peripheral')) return 'peripheral'
  return 'infrastructure'
}

function collectConnectedComponentGroups(graph) {
  const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]))
  graph.edges.forEach(({ sourceId, targetId }) => {
    adjacency.get(sourceId)?.push(targetId)
    adjacency.get(targetId)?.push(sourceId)
  })
  const remaining = new Set(graph.nodes.map(({ id }) => id))
  const groups = []
  while (remaining.size) {
    const seed = [...remaining].sort()[0]
    const queue = [seed]
    const nodeIds = []
    remaining.delete(seed)
    while (queue.length) {
      const current = queue.shift()
      nodeIds.push(current)
      ;[...(adjacency.get(current) || [])].sort().forEach((neighbor) => {
        if (!remaining.has(neighbor)) return
        remaining.delete(neighbor)
        queue.push(neighbor)
      })
    }
    groups.push(nodeIds)
  }
  return groups.sort((left, right) => (
    right.length - left.length || left[0].localeCompare(right[0])
  ))
}

function segmentComponentGroups(componentGroups, graph, pageSize) {
  const chunks = []
  let pending = []
  const flush = () => {
    if (!pending.length) return
    chunks.push(pending)
    pending = []
  }
  componentGroups.forEach((componentNodeIds) => {
    if (componentNodeIds.length > pageSize) {
      flush()
      splitOversizedComponent(componentNodeIds, graph, pageSize)
        .forEach((chunk) => chunks.push(chunk))
      return
    }
    if (pending.length + componentNodeIds.length > pageSize) flush()
    pending.push(...componentNodeIds)
  })
  flush()
  return chunks
}

function splitOversizedComponent(nodeIds, graph, pageSize) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const byNetwork = new Map()
  nodeIds.forEach((nodeId) => {
    const networkId = nodeById.get(nodeId)?.networkIds?.[0] || 'unassigned'
    byNetwork.set(networkId, [...(byNetwork.get(networkId) || []), nodeId])
  })
  const orderedGroups = byNetwork.size > 1
    ? [...byNetwork.values()]
    : [connectedTraversalOrder({
      nodes: nodeIds.map((id) => ({ id })),
      edges: graph.edges.filter(({ sourceId, targetId }) => (
        nodeIds.includes(sourceId) && nodeIds.includes(targetId)
      )),
    })]
  return orderedGroups.flatMap((group) => {
    const chunks = []
    for (let index = 0; index < group.length; index += pageSize) {
      chunks.push(group.slice(index, index + pageSize))
    }
    return chunks
  })
}

function buildTraceEdges(tracePath, traceRelations, networks) {
  return tracePath.slice(1).map((targetId, index) => {
    const sourceId = tracePath[index]
    const relation = traceRelations[index]
    const fallbackNetwork = networks.find((network) =>
      (network.edges || []).some(([left, right]) =>
        (left === sourceId && right === targetId)
        || (left === targetId && right === sourceId),
      ),
    )
    return {
      sourceId,
      targetId,
      networkId: relation?.networkId || fallbackNetwork?.id || null,
      relationType: relation?.relationType || 'explicit-network-edge',
      relationSource: relation?.relationSource || 'explicit',
      relationStatus: relation?.relationStatus || 'confirmed',
      pathGeometryId: relation?.pathGeometryId,
      sourceGeometryId: relation?.sourceGeometryId,
      sourceGeometryIds: relation?.sourceGeometryIds || [],
      order: index,
    }
  })
}

function chooseCoreAnchor(nodeIds, edges, assetById) {
  const degree = new Map(nodeIds.map((assetId) => [assetId, 0]))
  edges.forEach((edge) => {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) || 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) || 0) + 1)
  })
  return [...nodeIds].sort((leftId, rightId) => {
    const connectorDifference = Number(isConnectorType(assetById.get(rightId)?.type))
      - Number(isConnectorType(assetById.get(leftId)?.type))
    if (connectorDifference) return connectorDifference
    const degreeDifference = (degree.get(rightId) || 0) - (degree.get(leftId) || 0)
    return degreeDifference || leftId.localeCompare(rightId)
  })[0]
}

function connectedTraversalOrder(graph) {
  const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]))
  graph.edges.forEach(({ sourceId, targetId }) => {
    adjacency.get(sourceId)?.push(targetId)
    adjacency.get(targetId)?.push(sourceId)
  })
  const remaining = new Set(graph.nodes.map(({ id }) => id))
  const output = []
  while (remaining.size) {
    const seed = [...remaining].sort()[0]
    const queue = [seed]
    remaining.delete(seed)
    while (queue.length) {
      const current = queue.shift()
      output.push(current)
      ;[...(adjacency.get(current) || [])].sort().forEach((neighbor) => {
        if (!remaining.has(neighbor)) return
        remaining.delete(neighbor)
        queue.push(neighbor)
      })
    }
  }
  return output
}

function deduplicateEdges(edges) {
  const seen = new Set()
  return edges.filter((edge) => {
    if (!edge.sourceId || !edge.targetId || edge.sourceId === edge.targetId) return false
    const key = [edge.networkId || '', ...[edge.sourceId, edge.targetId].sort()].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pointWithinGeographicBounds(asset, bounds) {
  const coordinate = asset?.coordinate
  if (!validViewportBounds(bounds)
    || !Array.isArray(coordinate)
    || !Number.isFinite(Number(coordinate[0]))
    || !Number.isFinite(Number(coordinate[1]))) return false
  return Number(coordinate[0]) >= bounds.west
    && Number(coordinate[0]) <= bounds.east
    && Number(coordinate[1]) >= bounds.south
    && Number(coordinate[1]) <= bounds.north
}

function averageSourcePosition(assets) {
  const positions = assets.map(getSourceDisplayPosition).filter(Boolean)
  if (!positions.length) return null
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  }
}

function getSourceDisplayPosition(asset) {
  if (!Number.isFinite(asset?.x) || !Number.isFinite(asset?.y)) return null
  return { x: asset.x, y: asset.y }
}

function getSourceDisplayBounds(nodes) {
  const positions = nodes.map(({ sourcePosition }) => sourcePosition)
    .filter((position) => Number.isFinite(position?.x) && Number.isFinite(position?.y))
  if (!positions.length) return null
  return {
    minX: Math.min(...positions.map(({ x }) => x)),
    maxX: Math.max(...positions.map(({ x }) => x)),
    minY: Math.min(...positions.map(({ y }) => y)),
    maxY: Math.max(...positions.map(({ y }) => y)),
  }
}

function centerOfDisplayBounds(bounds) {
  if (!bounds || ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)) {
    return null
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

function collectScopeGeometryIds({
  mode,
  geometries,
  networks,
  selectedNetworkIds,
  selectedLayerIds,
  viewportBounds,
  scopedEdges,
}) {
  const geometryIds = new Set(scopedEdges.flatMap(edgeGeometryIds))
  if (mode === 'full-map') {
    geometries.forEach((geometry) => geometryIds.add(geometry.id))
    return [...geometryIds].sort()
  }
  if (mode === 'trace' || mode === 'focus') {
    return [...geometryIds]
  }
  if (mode === 'network') {
    const selectedIds = new Set(selectedNetworkIds)
    networks
      .filter((network) => selectedIds.has(network.id))
      .flatMap((network) => network.geometryIds || [])
      .forEach((geometryId) => geometryIds.add(geometryId))
  } else if (mode === 'layer') {
    const selectedIds = new Set(selectedLayerIds)
    geometries
      .filter((geometry) => selectedIds.has(geometry.layerId))
      .forEach((geometry) => geometryIds.add(geometry.id))
  } else if (mode === 'viewport') {
    geometries
      .filter((geometry) => geometryIntersectsGeographicBounds(geometry, viewportBounds))
      .forEach((geometry) => geometryIds.add(geometry.id))
  }
  return [...geometryIds].sort()
}

function edgeGeometryIds(edge) {
  return uniqueIds([
    edge.pathGeometryId,
    edge.sourceGeometryId,
    ...(edge.sourceGeometryIds || []),
  ].filter(Boolean))
}

function geometryIntersectsGeographicBounds(geometry, bounds) {
  if (!validViewportBounds(bounds)) return false
  const positions = flattenCoordinates(geometry?.coordinates)
  if (!positions.length) return false
  if (positions.some((coordinate) => coordinateWithinBounds(coordinate, bounds))) return true
  if (geometry.geometryType !== 'line_string') {
    const geometryBounds = boundsFromPositions(positions)
    return boundsOverlap(geometryBounds, bounds)
  }
  return positions.slice(1).some((end, index) => (
    segmentIntersectsBounds(positions[index], end, bounds)
  ))
}

function segmentIntersectsBounds(start, end, bounds) {
  if (coordinateWithinBounds(start, bounds) || coordinateWithinBounds(end, bounds)) return true
  const segmentBounds = boundsFromPositions([start, end])
  if (!boundsOverlap(segmentBounds, bounds)) return false
  const rectangleEdges = [
    [[bounds.west, bounds.south], [bounds.east, bounds.south]],
    [[bounds.east, bounds.south], [bounds.east, bounds.north]],
    [[bounds.east, bounds.north], [bounds.west, bounds.north]],
    [[bounds.west, bounds.north], [bounds.west, bounds.south]],
  ]
  return rectangleEdges.some(([left, right]) => segmentsIntersect(start, end, left, right))
}

function segmentsIntersect(a, b, c, d) {
  const direction = (p, q, r) => (
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  )
  const first = direction(a, b, c)
  const second = direction(a, b, d)
  const third = direction(c, d, a)
  const fourth = direction(c, d, b)
  return ((first <= 0 && second >= 0) || (first >= 0 && second <= 0))
    && ((third <= 0 && fourth >= 0) || (third >= 0 && fourth <= 0))
}

function flattenCoordinates(value) {
  if (!Array.isArray(value)) return []
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return [[Number(value[0]), Number(value[1])]]
  }
  return value.flatMap(flattenCoordinates)
}

function coordinateWithinBounds([longitude, latitude], bounds) {
  return longitude >= bounds.west && longitude <= bounds.east
    && latitude >= bounds.south && latitude <= bounds.north
}

function boundsFromPositions(positions) {
  return {
    west: Math.min(...positions.map(([longitude]) => longitude)),
    east: Math.max(...positions.map(([longitude]) => longitude)),
    south: Math.min(...positions.map(([, latitude]) => latitude)),
    north: Math.max(...positions.map(([, latitude]) => latitude)),
  }
}

function boundsOverlap(first, second) {
  return first.west <= second.east
    && first.east >= second.west
    && first.south <= second.north
    && first.north >= second.south
}

function validViewportBounds(bounds) {
  return bounds
    && [bounds.west, bounds.east, bounds.south, bounds.north].every(Number.isFinite)
}

function buildGeometryAggregateGraph({
  mode,
  networks,
  geometries,
  representedGeometryIds,
  selectedNetworkIds,
  selectedLayerIds,
}) {
  const represented = new Set(representedGeometryIds)
  const lineCount = geometries.filter((geometry) => (
    represented.has(geometry.id) && geometry.geometryType === 'line_string'
  )).length
  const selectedNetwork = networks.find((network) => selectedNetworkIds.includes(network.id))
  const label = selectedNetwork?.name
    || (mode === 'layer' ? 'Layer terpilih' : 'Area peta saat ini')
  const node = {
    id: `group:${mode}:${selectedNetwork?.id || selectedLayerIds[0] || 'viewport'}`,
    assetId: null,
    label,
    name: label,
    shortName: `0 node · ${lineCount} line`,
    type: selectedNetwork?.type || 'Jaringan',
    category: selectedNetwork ? categoryForNetwork(selectedNetwork) : 'infrastructure',
    location: `${representedGeometryIds.length} geometri`,
    sourcePosition: centerOfDisplayBounds(selectedNetwork?.displayBounds) || { x: .5, y: .5 },
    isAnchor: true,
    isConnector: true,
    isGroup: true,
    groupType: 'network-aggregate',
    groupId: selectedNetwork?.id || null,
    memberCount: 0,
    memberIds: [],
    nodeCount: 0,
    lineCount,
    edgeCount: 0,
    isolatedNodeCount: 0,
    connectedComponentCount: 0,
    bounds: selectedNetwork?.bounds || null,
    representedNodeIds: [],
    representedGeometryIds,
    detailScopeKey: selectedNetwork ? `network:${selectedNetwork.id}` : mode,
    order: null,
  }
  return {
    status: 'ready',
    mode,
    anchorAssetId: node.id,
    nodes: [node],
    edges: [],
    nodeCount: 0,
    aggregateNodeCount: 1,
    representedNodeIds: [],
    representedGeometryIds,
    layoutDensity: 'overview',
    sourceBounds: getSourceDisplayBounds([node]),
    title: label,
  }
}

function normalizeDiagramScope(scope) {
  if (scope === 'overview-pengapon') return 'overview'
  if (scope === 'current-viewport') return 'viewport'
  if (scope === 'focused-asset-depth-1' || scope === 'focused-asset-depth-2') return 'focus'
  if (scope === 'connected-component') return 'component'
  if (scope === 'active-trace') return 'trace'
  if (scope === 'selected-network') return 'network'
  if (scope === 'selected-layer') return 'layer'
  return scope
}

function resolveCategory(asset, networks) {
  const source = `${asset.category || ''} ${asset.type || ''}`.toLowerCase()
  if (source.includes('cctv') || source.includes('nvr') || source.includes('junction')) return 'cctv'
  if (source.includes('fiber') || source.includes('otb')) return 'fiber-optic'
  if (source.includes('printer') || source.includes('peripheral')) return 'peripheral'
  if (source.includes('lan')) return 'lan'
  const networkTypes = networks
    .filter((network) => network.nodeIds?.includes(asset.id))
    .map((network) => network.type)
    .join(' ')
    .toLowerCase()
  if (networkTypes.includes('cctv')) return 'cctv'
  if (networkTypes.includes('fiber')) return 'fiber-optic'
  if (networkTypes.includes('lan')) return 'lan'
  return 'infrastructure'
}

function categoryForNetwork(network) {
  const source = `${network.categoryKey || ''} ${network.type || ''}`.toLowerCase()
  if (source.includes('cctv')) return 'cctv'
  if (source.includes('fiber')) return 'fiber-optic'
  if (source.includes('peripheral')) return 'peripheral'
  if (source.includes('lan')) return 'lan'
  return 'infrastructure'
}

function isConnectorType(type = '') {
  return ['switch', 'junction', 'otb', 'server', 'nvr', 'router']
    .some((keyword) => type.toLowerCase().includes(keyword))
}

function getDiagramTitle(mode, nodes, networkById, selectedIds, focusDepth) {
  if (mode === 'trace') return 'Jalur koneksi terpilih'
  if (mode === 'full-map') return 'Peta jaringan lengkap'
  if (mode === 'viewport') return 'Area peta saat ini'
  if (mode === 'layer') return 'Area atau layer terpilih'
  if (mode === 'focus') {
    return `Relasi depth ${focusDepth} ${nodes.find((node) => node.isAnchor)?.name || 'aset fokus'}`
  }
  if (mode === 'component') return 'Connected component aset fokus'
  const selectedNames = [...selectedIds]
    .map((networkId) => networkById.get(networkId)?.shortName)
    .filter(Boolean)
  return selectedNames.length === 1 ? selectedNames[0] : 'Jaringan aset terpilih'
}

function emptyGraph(mode, message) {
  return { status: 'empty', message, mode, nodes: [], edges: [] }
}

function relationUnavailableGraph(mode, nodeCount) {
  return {
    status: 'relation-unavailable',
    mode,
    nodeCount,
    edgeCount: 0,
    message: `${nodeCount} aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi.`,
    nodes: [],
    edges: [],
    representedNodeIds: [],
    representedGeometryIds: [],
  }
}

function emptyMessageFor(mode) {
  if (mode === 'viewport') return 'Tidak ada asset node di area peta saat ini.'
  if (mode === 'layer') return 'Layer terpilih tidak memiliki asset node yang dapat dibuat diagram.'
  return 'Tidak ada aset yang dapat digunakan untuk membuat diagram.'
}

function normalizeIp(ip) {
  if (!ip || ['—', 'â€”', '-'].includes(ip)) return ''
  return ip
}

function uniqueIds(ids) {
  return [...new Set(ids)]
}
