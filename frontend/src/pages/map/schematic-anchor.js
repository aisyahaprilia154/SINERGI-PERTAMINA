const TYPE_PRIORITY = Object.freeze([
  { score: 700, test: (node) => node.isCoreNode || /\bcore\s*switch\b/i.test(node.type || '') },
  { score: 600, test: (node) => /\bnvr\b/i.test(node.type || '') },
  { score: 500, test: (node) => /\bserver\b/i.test(node.type || '') },
  { score: 400, test: (node) => /\botb\b/i.test(node.type || '') },
  { score: 300, test: (node) => /junction|\bjb\b/i.test(node.type || '') },
  { score: 200, test: (node) => node.isVirtual === true },
])

/**
 * Selects one deterministic anchor per connected component without changing
 * the scoped TopologyGraph. A focused asset remains the first anchor choice.
 */
export function chooseDiagramAnchors(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const adjacency = createAdjacency(graph.nodes, graph.edges)
  const isolatedNodeIds = graph.nodes
    .filter(({ id }) => (adjacency.get(id) || []).length === 0)
    .map(({ id }) => id)
    .sort()
  const isolated = new Set(isolatedNodeIds)
  const remaining = new Set(graph.nodes
    .map(({ id }) => id)
    .filter((id) => !isolated.has(id)))
  const components = []

  while (remaining.size) {
    const seed = [...remaining].sort()[0]
    const queue = [seed]
    const nodeIds = []
    remaining.delete(seed)
    while (queue.length) {
      const currentId = queue.shift()
      nodeIds.push(currentId)
      ;[...(adjacency.get(currentId) || [])]
        .sort((left, right) => left.localeCompare(right))
        .forEach((neighborId) => {
          if (!remaining.has(neighborId)) return
          remaining.delete(neighborId)
          queue.push(neighborId)
        })
    }
    const componentIds = new Set(nodeIds)
    const edges = graph.edges.filter(({ sourceId, targetId }) => (
      componentIds.has(sourceId) && componentIds.has(targetId)
    ))
    const anchorId = selectComponentAnchor({
      graph,
      nodeIds,
      edges,
      nodeById,
    })
    components.push({
      id: `component:${[...nodeIds].sort()[0]}`,
      nodeIds: [...nodeIds].sort(),
      edgeIds: edges.map(({ id }) => id).sort(),
      anchorId,
    })
  }

  components.sort((left, right) => (
    right.nodeIds.length - left.nodeIds.length
    || left.id.localeCompare(right.id)
  ))

  return {
    primaryAnchorId: components[0]?.anchorId
      || graph.anchorAssetId
      || isolatedNodeIds[0]
      || null,
    components,
    isolatedNodeIds,
    adjacency,
  }
}

function selectComponentAnchor({
  graph,
  nodeIds,
  edges,
  nodeById,
}) {
  if (['focus', 'trace'].includes(graph.mode)
    && nodeIds.includes(graph.anchorAssetId)) {
    return graph.anchorAssetId
  }

  const degree = new Map(nodeIds.map((id) => [id, 0]))
  edges.forEach(({ sourceId, targetId }) => {
    degree.set(sourceId, (degree.get(sourceId) || 0) + 1)
    degree.set(targetId, (degree.get(targetId) || 0) + 1)
  })

  return [...nodeIds].sort((leftId, rightId) => {
    const left = nodeById.get(leftId)
    const right = nodeById.get(rightId)
    return anchorTypeScore(right) - anchorTypeScore(left)
      || (degree.get(rightId) || 0) - (degree.get(leftId) || 0)
      || leftId.localeCompare(rightId)
  })[0]
}

function anchorTypeScore(node) {
  return TYPE_PRIORITY.find(({ test }) => test(node))?.score || 0
}

function createAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map(({ id }) => [id, []]))
  edges.forEach(({ sourceId, targetId }) => {
    if (!adjacency.has(sourceId) || !adjacency.has(targetId)) return
    adjacency.get(sourceId).push(targetId)
    adjacency.get(targetId).push(sourceId)
  })
  return adjacency
}

export const schematicAnchorInternals = {
  anchorTypeScore,
  createAdjacency,
}
