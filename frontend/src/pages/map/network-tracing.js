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

function uniqueRelations(relations) {
  const seenAssetIds = new Set()
  return relations.filter((relation) => {
    if (seenAssetIds.has(relation.targetAssetId)) return false
    seenAssetIds.add(relation.targetAssetId)
    return true
  })
}
