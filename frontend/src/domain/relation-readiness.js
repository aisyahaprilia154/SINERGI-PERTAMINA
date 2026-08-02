export const RELATION_STATUSES = Object.freeze({
  EXPLICIT_CONFIRMED: 'explicit_confirmed',
  ADMIN_CONFIRMED: 'admin_confirmed',
  INFERRED_PENDING: 'inferred_pending',
  AMBIGUOUS: 'ambiguous',
  UNRESOLVED: 'unresolved',
  REJECTED: 'rejected',
})

export const USER_CONFIRMED_RELATION_STATUSES = Object.freeze([
  RELATION_STATUSES.EXPLICIT_CONFIRMED,
  RELATION_STATUSES.ADMIN_CONFIRMED,
])

/**
 * Normalizes legacy relation records without changing the persisted source.
 * A legacy inferred "confirmed" edge is intentionally downgraded to pending:
 * only explicit metadata or an Administrator decision may enter the User graph.
 */
export function normalizeRelationStatus(relation = {}) {
  const status = String(relation.relationStatus ?? '').trim().toLowerCase()
  if (Object.values(RELATION_STATUSES).includes(status)) return status

  const source = String(relation.relationSource ?? '').trim().toLowerCase()
  if (source === 'explicit' || source === 'metadata') {
    return RELATION_STATUSES.EXPLICIT_CONFIRMED
  }
  if (source === 'admin') return RELATION_STATUSES.ADMIN_CONFIRMED
  if (source.startsWith('inferred')) return RELATION_STATUSES.INFERRED_PENDING
  if (status === 'confirmed' && !source) {
    return RELATION_STATUSES.EXPLICIT_CONFIRMED
  }
  if (status === 'confirmed_inferred') {
    return RELATION_STATUSES.INFERRED_PENDING
  }
  return RELATION_STATUSES.UNRESOLVED
}

export function isUserConfirmedRelation(relation) {
  return USER_CONFIRMED_RELATION_STATUSES.includes(
    normalizeRelationStatus(relation),
  )
}

export function isPendingRelation(relation) {
  return normalizeRelationStatus(relation) === RELATION_STATUSES.INFERRED_PENDING
}

export function filterUserConfirmedRelations(relations = []) {
  return relations.filter(isUserConfirmedRelation)
}

export function evaluateRelationReadiness({
  topologyGraph = null,
  nodeIds = null,
  assetId = null,
  networkIds = null,
  layerIds = null,
} = {}) {
  const nodes = Array.isArray(topologyGraph?.nodes) ? topologyGraph.nodes : []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const requestedNodeIds = resolveRequestedNodeIds({
    nodes,
    nodeIds,
    assetId,
    layerIds,
  })
  const requestedNetworks = networkIds == null
    ? null
    : new Set(networkIds)
  const confirmedEdges = (topologyGraph?.edges ?? [])
    .filter(isUserConfirmedRelation)
    .filter((edge) => edgeMatchesNetwork(edge, requestedNetworks))
  const pendingEdges = (topologyGraph?.candidateEdges ?? topologyGraph?.inferredEdges ?? [])
    .filter(isPendingRelation)
    .filter((edge) => edgeMatchesNetwork(edge, requestedNetworks))
  const geographicLines = (topologyGraph?.geographicLines ?? [])
    .filter((line) => geographicLineMatchesScope(line, {
      requestedNetworks,
      layerIds,
      requestedNodeIds,
      assetId,
      attachments: topologyGraph?.attachments ?? [],
    }))

  if (assetId) {
    requestedNodeIds.add(assetId)
    ;[...confirmedEdges, ...pendingEdges].forEach((edge) => {
      if (edge.sourceNodeId === assetId) requestedNodeIds.add(edge.targetNodeId)
      if (edge.targetNodeId === assetId) requestedNodeIds.add(edge.sourceNodeId)
    })
  }
  if (requestedNetworks) {
    ;[...confirmedEdges, ...pendingEdges].forEach((edge) => {
      requestedNodeIds.add(edge.sourceNodeId)
      requestedNodeIds.add(edge.targetNodeId)
    })
  }

  const scopedConfirmedEdges = confirmedEdges.filter((edge) => (
    requestedNodeIds.has(edge.sourceNodeId)
    && requestedNodeIds.has(edge.targetNodeId)
    && (!assetId
      || edge.sourceNodeId === assetId
      || edge.targetNodeId === assetId)
  ))
  const scopedPendingEdges = pendingEdges.filter((edge) => (
    requestedNodeIds.has(edge.sourceNodeId)
    && requestedNodeIds.has(edge.targetNodeId)
    && (!assetId
      || edge.sourceNodeId === assetId
      || edge.targetNodeId === assetId)
  ))
  const connectedNodeIds = new Set(scopedConfirmedEdges.flatMap((edge) => (
    [edge.sourceNodeId, edge.targetNodeId]
  )))
  const existingNodeIds = [...requestedNodeIds].filter((id) => nodeById.has(id))
  const isolatedNodeCount = existingNodeIds.filter((id) => !connectedNodeIds.has(id)).length
  const connectedComponentCount = countComponents(
    existingNodeIds,
    scopedConfirmedEdges,
  )
  const unresolvedCount = (topologyGraph?.unresolvedEndpoints ?? [])
    .filter((diagnostic) => diagnosticMatchesScope(
      diagnostic,
      requestedNodeIds,
      requestedNetworks,
      {
        includeUnscoped: assetId == null
          && nodeIds == null
          && networkIds == null
          && layerIds == null,
      },
    )).length
  const canTrace = Boolean(assetId && scopedConfirmedEdges.some((edge) => (
    edge.sourceNodeId === assetId || edge.targetNodeId === assetId
  )))
  const canCreateDiagram = scopedConfirmedEdges.length > 0
    && connectedNodeIds.size >= 2

  return {
    nodeCount: existingNodeIds.length,
    geographicLineCount: geographicLines.length,
    confirmedEdgeCount: scopedConfirmedEdges.length,
    pendingEdgeCount: scopedPendingEdges.length,
    inferredEdgeCount: scopedPendingEdges.length,
    unresolvedEndpointCount: unresolvedCount,
    unresolvedCount,
    isolatedNodeCount,
    connectedComponentCount,
    canTrace,
    canCreateDiagram,
    reason: readinessReason({
      assetId,
      nodeCount: existingNodeIds.length,
      canTrace,
      canCreateDiagram,
    }),
  }
}

export function buildRelationReadinessIndex({
  topologyGraph,
  assets = [],
  networks = [],
  layers = [],
} = {}) {
  const assetsById = Object.fromEntries(assets.map((asset) => [
    asset.id,
    evaluateRelationReadiness({
      topologyGraph,
      assetId: asset.id,
    }),
  ]))
  const networksById = Object.fromEntries(networks.map((network) => [
    network.id,
    evaluateRelationReadiness({
      topologyGraph,
      nodeIds: network.nodeIds ?? [],
      networkIds: [network.id],
    }),
  ]))
  const layersById = Object.fromEntries(layers.map((layer) => [
    layer.id,
    evaluateRelationReadiness({
      topologyGraph,
      nodeIds: assets
        .filter((asset) => asset.layerId === layer.id)
        .map((asset) => asset.id),
      layerIds: [layer.id],
    }),
  ]))
  return {
    assetsById,
    networksById,
    layersById,
    scope: evaluateRelationReadiness({ topologyGraph }),
  }
}

function resolveRequestedNodeIds({
  nodes,
  nodeIds,
  assetId,
  layerIds,
}) {
  if (nodeIds != null) return new Set(nodeIds)
  if (assetId) return new Set([assetId])
  if (layerIds != null) {
    const selectedLayers = new Set(layerIds)
    return new Set(nodes
      .filter((node) => selectedLayers.has(node.layerId))
      .map((node) => node.id))
  }
  return new Set(nodes.map((node) => node.id))
}

function edgeMatchesNetwork(edge, networkIds) {
  return !networkIds || networkIds.has(edge.networkId)
}

function geographicLineMatchesScope(line, {
  requestedNetworks,
  layerIds,
  requestedNodeIds,
  assetId,
  attachments,
}) {
  if (requestedNetworks && !requestedNetworks.has(line.networkId)) return false
  if (layerIds != null && !new Set(layerIds).has(line.layerId)) return false
  if (!assetId && !requestedNetworks && layerIds == null) return true

  const attachedNodeIds = attachments
    .filter((attachment) => (
      attachment.pathGeometryId === line.id
      || attachment.sourceGeometryId === line.id
    ))
    .map((attachment) => attachment.nodeId)
  if (assetId) return attachedNodeIds.includes(assetId)
  if (requestedNetworks) return true
  return attachedNodeIds.some((nodeId) => requestedNodeIds.has(nodeId))
}

function diagnosticMatchesScope(
  diagnostic,
  nodeIds,
  networkIds,
  { includeUnscoped = false } = {},
) {
  if (networkIds && diagnostic.networkId && !networkIds.has(diagnostic.networkId)) {
    return false
  }
  const references = [
    diagnostic.nodeId,
    diagnostic.sourceNodeId,
    diagnostic.targetNodeId,
    diagnostic.sourceAssetId,
    diagnostic.targetAssetId,
  ].filter(Boolean)
  return references.length
    ? references.some((reference) => nodeIds.has(reference))
    : includeUnscoped
}

function countComponents(nodeIds, edges) {
  if (!nodeIds.length) return 0
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]))
  edges.forEach((edge) => {
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId)
    adjacency.get(edge.targetNodeId)?.push(edge.sourceNodeId)
  })
  const visited = new Set()
  let componentCount = 0
  nodeIds.forEach((nodeId) => {
    if (visited.has(nodeId)) return
    componentCount += 1
    const queue = [nodeId]
    visited.add(nodeId)
    while (queue.length) {
      const current = queue.shift()
      for (const adjacent of adjacency.get(current) ?? []) {
        if (visited.has(adjacent)) continue
        visited.add(adjacent)
        queue.push(adjacent)
      }
    }
  })
  return componentCount
}

function readinessReason({
  assetId,
  nodeCount,
  canTrace,
  canCreateDiagram,
}) {
  if (assetId && !canTrace) return 'Relasi aset belum tersedia.'
  if (!canCreateDiagram) {
    return `${nodeCount} aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi.`
  }
  return ''
}
