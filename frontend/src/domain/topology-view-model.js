const CATEGORY_ORDER = ['cctv', 'fiber-optic', 'lan', 'infrastructure', 'peripheral', 'unmapped']

export function buildTopologyViewModel({
  assets = [],
  graph,
  candidates = [],
  state = {},
}) {
  const confirmedGraph = sanitizeConfirmedGraph(graph)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const degreeByNode = confirmedGraph.degreeByNode ?? calculateDegree(confirmedGraph)
  const componentByNode = new Map()
  ;(confirmedGraph.components ?? []).forEach((component, index) => {
    ;(component.nodeIds ?? []).forEach((id) => componentByNode.set(id, component.id ?? `component-${index + 1}`))
  })
  const categories = new Set(state.selectedCategories ?? [])
  const query = String(state.search ?? '').trim().toLowerCase()
  const selectedId = state.selectedAssetId ?? null
  const neighborIds = selectedId
    ? new Set(confirmedGraph.edges.flatMap((edge) => {
      if (edge.sourceAssetId === selectedId) return [edge.targetAssetId]
      if (edge.targetAssetId === selectedId) return [edge.sourceAssetId]
      return []
    }))
    : new Set()
  const traceIds = new Set(state.traceAssetIds ?? [])

  const nodes = confirmedGraph.nodes.map((node) => {
    const asset = assetById.get(node.id) ?? assetById.get(node.assetId)
    const category = categoryKey(asset?.category, asset?.type, node.networkFamily)
    const matchesCategory = !categories.size || categories.has(category)
    const matchesSearch = !query || `${node.id} ${asset?.name ?? ''} ${asset?.type ?? ''}`
      .toLowerCase().includes(query)
    const inFocus = !state.focusOnly || !selectedId
      || node.id === selectedId || neighborIds.has(node.id)
    return {
      id: node.id,
      name: asset?.name ?? node.assetId ?? node.id,
      type: asset?.type ?? node.assetType ?? 'Aset',
      category,
      networkFamily: node.networkFamily ?? category,
      componentId: componentByNode.get(node.id) ?? `isolated:${node.id}`,
      degree: degreeByNode[node.id] ?? 0,
      selected: node.id === selectedId,
      neighbor: neighborIds.has(node.id),
      traced: traceIds.has(node.id),
      dimmed: !matchesCategory || !matchesSearch || !inFocus,
      candidateCount: candidates.filter((candidate) => (
        candidate.targetAssetId === node.id
        || candidate.sourcePathAssetId === node.id
      )).length,
      isCore: isCore(asset?.type ?? node.assetType) || (degreeByNode[node.id] ?? 0) >= 3,
    }
  })
  const includedNodeIds = new Set(nodes.map(({ id }) => id))
  const edges = confirmedGraph.edges
    .filter((edge) => includedNodeIds.has(edge.sourceAssetId)
      && includedNodeIds.has(edge.targetAssetId))
    .map((edge) => ({
      ...edge,
      sourceId: edge.sourceAssetId,
      targetId: edge.targetAssetId,
      traced: traceIds.has(edge.sourceAssetId) && traceIds.has(edge.targetAssetId),
      dimmed: nodes.find(({ id }) => id === edge.sourceAssetId)?.dimmed
        || nodes.find(({ id }) => id === edge.targetAssetId)?.dimmed,
    }))
  return {
    datasetVersionId: confirmedGraph.datasetVersionId,
    nodes,
    edges,
    categories: CATEGORY_ORDER.filter((category) => nodes.some((node) => node.category === category)),
    graphNodeCount: confirmedGraph.nodes.length,
    graphEdgeCount: confirmedGraph.edges.length,
    componentCount: confirmedGraph.components?.length ?? 0,
    isolatedNodeCount: confirmedGraph.isolatedNodeIds?.length ?? 0,
  }
}

export function sanitizeConfirmedGraph(graph = {}) {
  const nodes = Array.isArray(graph.nodes) ? structuredClone(graph.nodes) : []
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const edges = (Array.isArray(graph.edges) ? graph.edges : [])
    .filter((edge) => (
      edge.verificationStatus === 'confirmed'
      && nodeIds.has(edge.sourceAssetId)
      && nodeIds.has(edge.targetAssetId)
      && edge.sourceAssetId !== edge.targetAssetId
    ))
    .map((edge) => structuredClone(edge))
  return {
    ...structuredClone(graph),
    nodes,
    edges,
    components: Array.isArray(graph.components) ? structuredClone(graph.components) : [],
    isolatedNodeIds: Array.isArray(graph.isolatedNodeIds)
      ? [...graph.isolatedNodeIds]
      : [],
  }
}

export function prioritizeTopologyCandidates(candidates = [], graph = {}) {
  const componentByNode = new Map()
  ;(graph.components ?? []).forEach((component) => {
    ;(component.nodeIds ?? []).forEach((id) => componentByNode.set(id, component.nodeIds.length))
  })
  return [...candidates].sort((left, right) => (
    priority(right, componentByNode) - priority(left, componentByNode)
    || (right.score ?? 0) - (left.score ?? 0)
    || left.candidateId.localeCompare(right.candidateId)
  ))
}

function priority(candidate, componentByNode) {
  const impact = componentByNode.get(candidate.targetAssetId) ?? 0
  if (candidate.candidateStatus === 'ambiguous') return 5000 + impact
  if (candidate.evidence?.some(({ evidenceType }) => /root|core/i.test(evidenceType))) {
    return 4000 + impact
  }
  if (candidate.candidateStatus === 'unresolved') return 2000
  return 3000 + Math.round((candidate.score ?? 0) * 100)
}

function calculateDegree(graph) {
  const result = Object.fromEntries(graph.nodes.map(({ id }) => [id, 0]))
  graph.edges.forEach((edge) => {
    result[edge.sourceAssetId] += 1
    result[edge.targetAssetId] += 1
  })
  return result
}

function categoryKey(...values) {
  const source = values.filter(Boolean).join(' ').toLowerCase()
  if (/cctv|camera|kamera|nvr|junction/.test(source)) return 'cctv'
  if (/fiber|fibre|\bfo\b|otb/.test(source)) return 'fiber-optic'
  if (/\blan\b|utp/.test(source)) return 'lan'
  if (/printer|peripheral|access point|\bap\b/.test(source)) return 'peripheral'
  if (/switch|router|server|rack|core|infrastructure/.test(source)) return 'infrastructure'
  return 'unmapped'
}

function isCore(type = '') {
  return /core|router|server|nvr|distribution|otb/i.test(type)
}
