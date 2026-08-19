/**
 * Builds a read-only traversal graph from the shared confirmed topology.
 * Legacy network relations remain supported for datasets without topology output.
 */
export function buildExplicitRelationGraph({ networks, assetIds, topologyGraph = null }) {
  const validAssetIds = new Set(assetIds)
  const graph = new Map([...validAssetIds].map((assetId) => [assetId, []]))
  const seenRelations = new Set()
  const topologyRelations = Array.isArray(topologyGraph?.edges)
    ? topologyGraph.edges.map((edge) => ({
      ...edge,
      sourceAssetId: edge.sourceAssetId || edge.sourceNodeId,
      targetAssetId: edge.targetAssetId || edge.targetNodeId,
    }))
    : []
  const relationGroups = topologyRelations.length
    ? [{ id: 'topology', relations: topologyRelations }]
    : networks

  for (const network of relationGroups) {
    const relationRecords = Array.isArray(network.relations) && network.relations.length
      ? network.relations
      : (network.edges || []).map(([sourceAssetId, targetAssetId]) => ({
        sourceAssetId,
        targetAssetId,
        relationType: 'explicit-network-edge',
      }))
    for (const relation of relationRecords) {
      if (relation.relationType === 'mounted_on' || !isConfirmedRelation(relation)) continue
      const { sourceAssetId, targetAssetId } = relation
      if (!validAssetIds.has(sourceAssetId) || !validAssetIds.has(targetAssetId)) continue
      if (sourceAssetId === targetAssetId) continue

      const relationId = topologyRelations.length
        ? relationMutationId(relation)
        : relationMutationId(relation) || relation.id || relation.edgeId || null
      const relationKey = relation.id || relation.edgeId || relationId
        || [network.id, relation.relationType, sourceAssetId, targetAssetId].join('|')
      if (seenRelations.has(relationKey)) continue
      seenRelations.add(relationKey)

      graph.get(sourceAssetId).push({
        id: relationId,
        edgeId: relation.id || relation.edgeId || null,
        sourceAssetId,
        targetAssetId,
        networkId: relation.networkId || network.id,
        relationType: relation.relationType || 'explicit-network-edge',
        pathAssetId: relation.pathAssetId,
        sourceGeometryId: relation.sourceGeometryId,
        relationSource: relation.relationSource || 'explicit',
        relationStatus: relation.relationStatus || 'confirmed',
      })
      graph.get(targetAssetId).push({
        id: relationId,
        edgeId: relation.id || relation.edgeId || null,
        sourceAssetId: targetAssetId,
        targetAssetId: sourceAssetId,
        networkId: relation.networkId || network.id,
        relationType: relation.relationType || 'explicit-network-edge',
        pathAssetId: relation.pathAssetId,
        sourceGeometryId: relation.sourceGeometryId,
        relationSource: relation.relationSource || 'explicit',
        relationStatus: relation.relationStatus || 'confirmed',
      })
    }
  }

  return graph
}

/**
 * Returns the persisted relation identity that the revoke API accepts.
 * A graph edge can collapse multiple source relations into one visual edge;
 * that aggregate must remain read-only until a single relation identity is
 * available. Manual/device edges always carry one source relation ID.
 */
export function relationMutationId(relation) {
  if (relation?.relationId) return relation.relationId
  const sourceRelationIds = Array.isArray(relation?.sourceRelationIds)
    ? relation.sourceRelationIds.filter(Boolean)
    : []
  return sourceRelationIds.length === 1 ? sourceRelationIds[0] : null
}

function isConfirmedRelation(relation) {
  if (relation.verificationStatus !== undefined) {
    return relation.verificationStatus === 'confirmed'
  }
  if (relation.candidateStatus !== undefined) {
    return relation.candidateStatus === 'confirmed'
  }
  if (relation.relationStatus !== undefined) {
    return relation.relationStatus === 'confirmed'
  }
  return relation.relationSource === undefined
    || ['explicit', 'explicit_kml_metadata', 'manual_review'].includes(relation.relationSource)
}

export function getConnectedAssets(graph, assetId) {
  return uniqueRelations(graph.get(assetId) || [])
}

export function findReachableDestinations(graph, sourceAssetId) {
  if (!graph.has(sourceAssetId)) return []

  const destinations = []
  const visited = new Set([sourceAssetId])
  const queue = [{ assetId: sourceAssetId, distance: 0 }]

  while (queue.length) {
    const current = queue.shift()
    for (const relation of graph.get(current.assetId) || []) {
      if (visited.has(relation.targetAssetId)) continue
      visited.add(relation.targetAssetId)
      const destination = {
        assetId: relation.targetAssetId,
        distance: current.distance + 1,
      }
      destinations.push(destination)
      queue.push(destination)
    }
  }

  return destinations
}

export function findTracePath(graph, sourceAssetId, targetAssetId) {
  if (!graph.has(sourceAssetId)) {
    return traceError('invalid-source', 'Aset awal tidak tersedia pada dataset aktif.')
  }
  if (!graph.has(targetAssetId)) {
    return traceError('invalid-target', 'Aset tujuan tidak tersedia pada dataset aktif.')
  }
  if (sourceAssetId === targetAssetId) {
    return {
      status: 'found',
      assetIds: [sourceAssetId],
      relations: [],
      explanation: 'Titik awal dan tujuan adalah aset yang sama.',
    }
  }

  const visited = new Set([sourceAssetId])
  const queue = [sourceAssetId]
  const predecessor = new Map()

  while (queue.length) {
    const currentAssetId = queue.shift()
    for (const relation of graph.get(currentAssetId) || []) {
      if (visited.has(relation.targetAssetId)) continue
      visited.add(relation.targetAssetId)
      predecessor.set(relation.targetAssetId, {
        assetId: currentAssetId,
        relation,
      })

      if (relation.targetAssetId === targetAssetId) {
        return reconstructPath(predecessor, sourceAssetId, targetAssetId)
      }
      queue.push(relation.targetAssetId)
    }
  }

  return traceError(
    'unreachable',
    'Tidak ada jalur topologi terkonfirmasi antara aset awal dan tujuan pada dataset aktif.',
  )
}

function reconstructPath(predecessor, sourceAssetId, targetAssetId) {
  const assetIds = [targetAssetId]
  const relations = []
  let currentAssetId = targetAssetId

  while (currentAssetId !== sourceAssetId) {
    const previous = predecessor.get(currentAssetId)
    if (!previous) {
      return traceError('broken-relation', 'Urutan relasi tidak dapat disusun secara lengkap.')
    }
    relations.unshift(previous.relation)
    assetIds.unshift(previous.assetId)
    currentAssetId = previous.assetId
  }

  return {
    status: 'found',
    assetIds,
    relations,
    explanation: 'Jalur terpendek berdasarkan graph topologi terkonfirmasi pada dataset aktif.',
  }
}

function uniqueRelations(relations) {
  const seenAssetIds = new Set()
  return relations.filter((relation) => {
    if (seenAssetIds.has(relation.targetAssetId)) return false
    seenAssetIds.add(relation.targetAssetId)
    return true
  })
}

function traceError(status, message) {
  return {
    status,
    message,
    assetIds: [],
    relations: [],
  }
}
