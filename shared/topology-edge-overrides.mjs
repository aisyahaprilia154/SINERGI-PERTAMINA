export function diagramEdgeKey(edge) {
  return JSON.stringify([
    [edge.sourceAssetId ?? edge.sourceNodeId ?? edge.sourceId,
      edge.targetAssetId ?? edge.targetNodeId ?? edge.targetId].sort(),
    edge.serviceDomain ?? '', edge.mediaType ?? '',
    [...(edge.pathAssetIds ?? (edge.pathAssetId ? [edge.pathAssetId] : []))].sort(),
  ])
}

export function filterRemovedDiagramEdges(edges = [], overrides = []) {
  const removed = overrides.filter(item => item.action === 'remove')
  if (!removed.length) return edges
  const ids = new Set(removed.map(item => item.edgeId))
  const keys = new Set(removed.map(item => item.edgeKey))
  return edges.filter(edge => !ids.has(edge.id ?? edge.relationId) && !keys.has(diagramEdgeKey(edge)))
}
