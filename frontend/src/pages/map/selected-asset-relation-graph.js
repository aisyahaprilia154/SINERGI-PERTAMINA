/**
 * Builds the diagram scope for one selected asset.
 *
 * This is intentionally a depth-one projection. It does not calculate a
 * route, walk a connected component, or infer relations from coordinates.
 */
export function buildSelectedAssetRelationGraph({
  selectedAssetId,
  topologyGraph = null,
  assets = [],
}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const focusNode = assetById.get(selectedAssetId) || null
  if (!focusNode) {
    return {
      status: 'empty',
      focusNode: null,
      nodes: [],
      edges: [],
      neighborCount: 0,
      relationCount: 0,
      categorySummary: {},
      message: 'Pilih satu aset pada peta untuk melihat relasinya.',
    }
  }

  const directEdges = (topologyGraph?.edges ?? [])
    .map(normalizeEdge)
    .filter(isConfirmedTopologyEdge)
    .filter((edge) => edge.sourceId === selectedAssetId || edge.targetId === selectedAssetId)
    .filter((edge) => edge.sourceId !== edge.targetId)

  const neighborIds = unique(directEdges.map((edge) => (
    edge.sourceId === selectedAssetId ? edge.targetId : edge.sourceId
  ))).filter((assetId) => assetById.has(assetId))
  const includedIds = new Set([selectedAssetId, ...neighborIds])
  const edges = deduplicateEdges(directEdges)
    .filter((edge) => includedIds.has(edge.sourceId) && includedIds.has(edge.targetId))
  const nodes = [focusNode, ...neighborIds.map((assetId) => assetById.get(assetId))]

  return {
    status: edges.length ? 'ready' : 'empty',
    focusNode,
    nodes,
    edges,
    neighborCount: neighborIds.length,
    relationCount: edges.length,
    categorySummary: summarizeCategories(nodes),
    message: edges.length
      ? ''
      : `${focusNode.name || 'Aset ini'} belum memiliki relasi terkonfirmasi.`,
  }
}

export function normalizeTopologyEdge(edge = {}) {
  return normalizeEdge(edge)
}

export function isConfirmedTopologyEdge(edge = {}) {
  const normalized = normalizeEdge(edge)
  return normalized.relationType !== 'mounted_on' && isConfirmedEdge(normalized)
}

function normalizeEdge(edge) {
  return {
    ...edge,
    sourceId: edge.sourceAssetId || edge.sourceNodeId,
    targetId: edge.targetAssetId || edge.targetNodeId,
    sourceGeometryIds: edge.sourceGeometryIds ?? [],
    pathAssetIds: edge.pathAssetIds ?? [],
  }
}

function isConfirmedEdge(edge) {
  const status = edge.verificationStatus || edge.candidateStatus || edge.relationStatus
  if (status) return ['confirmed', 'explicit_confirmed', 'admin_confirmed'].includes(status)
  if (['inferred_pending', 'ambiguous', 'unresolved', 'rejected'].includes(edge.relationSource)) {
    return false
  }
  return true
}

function deduplicateEdges(edges) {
  const seen = new Set()
  return edges.filter((edge) => {
    if (!edge.sourceId || !edge.targetId) return false
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function summarizeCategories(nodes) {
  return nodes.reduce((summary, asset) => {
    const key = categoryKey(asset)
    summary[key] = (summary[key] || 0) + 1
    return summary
  }, {})
}

function categoryKey(asset = {}) {
  const value = `${asset.category || ''} ${asset.type || ''}`.toLowerCase()
  if (value.includes('junction')) return 'Junction Box'
  if (value.includes('cctv') || value.includes('camera')) return 'CCTV'
  if (value.includes('switch')) return 'Switch'
  if (value.includes('server') || value.includes('nvr')) return 'Server / NVR'
  if (value.includes('otb')) return 'OTB'
  if (value.includes('tiang') || value.includes('pole')) return 'Tiang'
  return asset.type || 'Aset lainnya'
}

function unique(values) {
  return [...new Set(values)]
}
