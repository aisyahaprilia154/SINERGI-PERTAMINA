const CONFIRMED_STATUSES = new Set(['confirmed', 'explicit_confirmed', 'admin_confirmed'])
const PENDING_STATUSES = new Set(['inferred_pending', 'ambiguous', 'unresolved', 'pending'])

export function isConfirmedRelation(edge = {}) {
  const status = String(edge.verificationStatus || edge.relationStatus || '').toLowerCase()
  if (CONFIRMED_STATUSES.has(status)) return true
  return !status && ['explicit', 'admin'].includes(String(edge.relationSource || '').toLowerCase())
}

export function evaluateRelationReadiness({
  assets = [],
  topologyGraph = {},
  selectedAssetId = null,
} = {}) {
  const nodeIds = new Set(assets.map(({ id }) => id))
  const allEdges = Array.isArray(topologyGraph.edges) ? topologyGraph.edges : []
  const confirmedEdges = allEdges.filter((edge) => {
    const sourceId = edge.sourceNodeId ?? edge.sourceId
    const targetId = edge.targetNodeId ?? edge.targetId
    return sourceId !== targetId && nodeIds.has(sourceId) && nodeIds.has(targetId)
      && isConfirmedRelation(edge)
  })
  const pendingEdges = [
    ...allEdges.filter((edge) => PENDING_STATUSES.has(String(
      edge.verificationStatus || edge.relationStatus || '',
    ).toLowerCase())),
    ...(topologyGraph.pendingEdges || []),
  ]
  const adjacency = new Map([...nodeIds].map((id) => [id, new Set()]))
  confirmedEdges.forEach((edge) => {
    const sourceId = edge.sourceNodeId ?? edge.sourceId
    const targetId = edge.targetNodeId ?? edge.targetId
    adjacency.get(sourceId)?.add(targetId)
    adjacency.get(targetId)?.add(sourceId)
  })
  const isolatedNodeIds = [...nodeIds].filter((id) => !adjacency.get(id)?.size)
  const components = buildComponents(nodeIds, adjacency)
  const selectedDegree = selectedAssetId ? adjacency.get(selectedAssetId)?.size || 0 : 0
  const canTrace = selectedAssetId ? selectedDegree > 0 : confirmedEdges.length > 0
  const canCreateDiagram = selectedAssetId
    ? components.some((component) => component.length >= 2 && component.includes(selectedAssetId))
    : components.some((component) => component.length >= 2)

  return {
    nodeCount: nodeIds.size,
    confirmedEdgeCount: confirmedEdges.length,
    pendingEdgeCount: pendingEdges.length,
    isolatedNodeCount: isolatedNodeIds.length,
    connectedComponentCount: components.length,
    confirmedEdges,
    isolatedNodeIds,
    components,
    canTrace,
    canCreateDiagram,
    unavailableReason: getUnavailableReason({ selectedAssetId, selectedDegree, nodeCount: nodeIds.size, confirmedEdgeCount: confirmedEdges.length }),
  }
}

function buildComponents(nodeIds, adjacency) {
  const visited = new Set()
  const components = []
  ;[...nodeIds].sort().forEach((startId) => {
    if (visited.has(startId) || !adjacency.get(startId)?.size) return
    const queue = [startId]
    const component = []
    visited.add(startId)
    while (queue.length) {
      const currentId = queue.shift()
      component.push(currentId)
      ;[...(adjacency.get(currentId) || [])].sort().forEach((nextId) => {
        if (visited.has(nextId)) return
        visited.add(nextId)
        queue.push(nextId)
      })
    }
    components.push(component)
  })
  return components.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]))
}

function getUnavailableReason({ selectedAssetId, selectedDegree, nodeCount, confirmedEdgeCount }) {
  if (!nodeCount) return 'Tidak ada aset pada cakupan aktif.'
  if (!confirmedEdgeCount) return `${nodeCount} aset ditemukan, tetapi belum ada relasi yang telah dikonfirmasi.`
  if (selectedAssetId && !selectedDegree) return 'Relasi aset belum tersedia. Aset ini belum memiliki koneksi terkonfirmasi.'
  return null
}
