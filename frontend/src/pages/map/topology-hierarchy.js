export function buildTopologyHierarchy(graph, { maxVisibleLeaves = 6 } = {}) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]))
  graph.edges.forEach((edge) => {
    adjacency.get(edge.sourceId)?.push({ id: edge.targetId, edge })
    adjacency.get(edge.targetId)?.push({ id: edge.sourceId, edge })
  })
  adjacency.forEach((items) => items.sort((left, right) => left.id.localeCompare(right.id)))

  const rootId = nodeById.has(graph.anchorAssetId) ? graph.anchorAssetId : graph.nodes[0]?.id
  const parentById = new Map([[rootId, null]])
  const depthById = new Map([[rootId, 0]])
  const childIdsById = new Map(graph.nodes.map((node) => [node.id, []]))
  const treeEdgeIds = new Set()
  const queue = rootId ? [rootId] : []
  while (queue.length) {
    const id = queue.shift()
    for (const { id: nextId, edge } of adjacency.get(id) || []) {
      if (depthById.has(nextId)) continue
      parentById.set(nextId, id)
      depthById.set(nextId, depthById.get(id) + 1)
      childIdsById.get(id).push(nextId)
      treeEdgeIds.add(edge.id)
      queue.push(nextId)
    }
  }

  const nodes = graph.nodes.map((node) => ({
    ...node,
    parentId: parentById.get(node.id) ?? null,
    depth: depthById.get(node.id) ?? 0,
    childIds: childIdsById.get(node.id) || [],
  }))
  const hiddenLeafIds = new Set()
  const aggregates = []
  nodes.forEach((node) => {
    const leafChildren = node.childIds.filter((id) => !(childIdsById.get(id) || []).length)
    if (leafChildren.length <= maxVisibleLeaves) return
    const hidden = leafChildren.slice(maxVisibleLeaves - 1)
    hidden.forEach((id) => hiddenLeafIds.add(id))
    node.childIds = node.childIds.filter((id) => !hiddenLeafIds.has(id))
    const aggregateId = `aggregate:${node.id}`
    node.childIds.push(aggregateId)
    aggregates.push({
      id: aggregateId,
      name: `${hidden.length} aset lainnya`,
      shortName: `+${hidden.length} aset`,
      shortLabel: `+${hidden.length} aset`,
      type: 'Kelompok aset',
      category: 'infrastructure',
      isAggregate: true,
      aggregateCount: hidden.length,
      aggregateAssetIds: hidden,
      parentId: node.id,
      depth: node.depth + 1,
      childIds: [],
    })
  })

  return {
    rootId,
    nodes: [...nodes.filter((node) => !hiddenLeafIds.has(node.id)), ...aggregates],
    edges: [
      ...graph.edges.filter((edge) => !hiddenLeafIds.has(edge.sourceId) && !hiddenLeafIds.has(edge.targetId))
        .map((edge) => ({ ...edge, isTreeEdge: treeEdgeIds.has(edge.id), isCycleEdge: !treeEdgeIds.has(edge.id) })),
      ...aggregates.map((node) => ({
        id: `aggregate-edge:${node.parentId}`,
        sourceId: node.parentId,
        targetId: node.id,
        networkName: 'Kelompok aset',
        networkColor: '#94a3b8',
        verificationStatus: 'confirmed',
        isTreeEdge: true,
        isAggregateEdge: true,
      })),
    ],
  }
}
