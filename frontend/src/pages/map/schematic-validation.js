export function validateSchematicProjection({
  sourceAssets = [],
  sourceConfirmedEdges = [],
  diagramNodes = [],
  diagramEdges = [],
  candidates = [],
} = {}) {
  const sourceIds = sourceAssets.map((asset) => asset?.id).filter(Boolean)
  const diagramIds = diagramNodes.map((node) => node?.id).filter(Boolean)
  const sourceIdSet = new Set(sourceIds)
  const diagramIdSet = new Set(diagramIds)
  const confirmedDiagramEdges = diagramEdges.filter((edge) => edge.relationStatus === 'confirmed')
  const sourceEdgeKeys = edgeKeys(sourceConfirmedEdges, sourceIdSet)
  const diagramEdgeKeys = edgeKeys(confirmedDiagramEdges, diagramIdSet)
  const connectedAssetIds = new Set(confirmedDiagramEdges.flatMap((edge) => (
    [edge.sourceId, edge.targetId]
  )))
  const scopedCandidates = candidates.filter((candidate) => {
    if (!isActiveCandidate(candidate)) return false
    const ids = candidateIds(candidate)
    return ids.length > 0 && ids.every((id) => sourceIdSet.has(id))
  })
  const candidateAssetIds = new Set(scopedCandidates
    .flatMap(candidateIds)
    .filter((id) => sourceIdSet.has(id)))
  const duplicateSourceAssetIds = duplicateValues(sourceIds)
  const duplicateDiagramNodeIds = duplicateValues(diagramIds)
  const missingAssetIds = [...sourceIdSet].filter((id) => !diagramIdSet.has(id)).sort()
  const unexpectedAssetIds = [...diagramIdSet].filter((id) => !sourceIdSet.has(id)).sort()
  const invalidEndpoints = diagramEdges.filter((edge) => (
    !diagramIdSet.has(edge.sourceId) || !diagramIdSet.has(edge.targetId)
  )).map((edge) => edge.id || `${edge.sourceId}:${edge.targetId}`)
  const selfLoops = diagramEdges.filter((edge) => edge.sourceId === edge.targetId)
    .map((edge) => edge.id || edge.sourceId)
  const duplicateConfirmedEdges = duplicateValues(confirmedDiagramEdges.map(edgeKey))
  const missingConfirmedEdgeKeys = [...sourceEdgeKeys].filter((key) => !diagramEdgeKeys.has(key)).sort()
  const unexpectedConfirmedEdgeKeys = [...diagramEdgeKeys].filter((key) => !sourceEdgeKeys.has(key)).sort()
  const nodeSetsMatch = sourceIdSet.size === diagramIdSet.size
    && missingAssetIds.length === 0 && unexpectedAssetIds.length === 0
  const confirmedEdgeSetsMatch = sourceEdgeKeys.size === diagramEdgeKeys.size
    && missingConfirmedEdgeKeys.length === 0 && unexpectedConfirmedEdgeKeys.length === 0
  const coveragePercent = sourceIdSet.size
    ? Math.round((sourceIdSet.size - missingAssetIds.length) / sourceIdSet.size * 100)
    : diagramIdSet.size === 0 ? 100 : 0

  return {
    sourceAssetCount: sourceIdSet.size,
    diagramNodeCount: diagramIdSet.size,
    sourceConfirmedRelationCount: sourceEdgeKeys.size,
    diagramConfirmedEdgeCount: diagramEdgeKeys.size,
    candidateRelationCount: scopedCandidates.length,
    unresolvedAssetCount: [...sourceIdSet].filter((id) => (
      !connectedAssetIds.has(id) && !candidateAssetIds.has(id)
    )).length,
    missingAssetIds,
    unexpectedAssetIds,
    duplicateSourceAssetIds,
    duplicateDiagramNodeIds,
    invalidEndpoints,
    selfLoops,
    duplicateConfirmedEdges,
    missingConfirmedEdgeKeys,
    unexpectedConfirmedEdgeKeys,
    coveragePercent,
    isCompleteCoverage: nodeSetsMatch,
    isConfirmedTopologyConsistent: confirmedEdgeSetsMatch,
    isValid: nodeSetsMatch && confirmedEdgeSetsMatch
      && duplicateSourceAssetIds.length === 0
      && duplicateDiagramNodeIds.length === 0
      && invalidEndpoints.length === 0
      && selfLoops.length === 0
      && duplicateConfirmedEdges.length === 0,
  }
}

function edgeKeys(edges, allowedIds) {
  return new Set(edges.filter((edge) => (
    edge?.sourceId && edge?.targetId && edge.sourceId !== edge.targetId
      && allowedIds.has(edge.sourceId) && allowedIds.has(edge.targetId)
  )).map(edgeKey))
}

function edgeKey(edge) {
  return [edge.sourceId, edge.targetId].sort().join('|')
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  })
  return [...duplicates].sort()
}

function isActiveCandidate(candidate) {
  return ['candidate', 'ambiguous'].includes(candidate?.candidateStatus)
    && !['rejected', 'revoked'].includes(candidate?.proposalStatus)
}

function candidateIds(candidate) {
  return [
    candidate.sourceAssetId,
    candidate.sourcePathAssetId,
    candidate.targetAssetId,
    candidate.targetPathAssetId,
  ].filter(Boolean)
}
