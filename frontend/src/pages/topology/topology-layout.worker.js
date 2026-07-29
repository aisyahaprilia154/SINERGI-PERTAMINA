import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

self.addEventListener('message', async (event) => {
  const { requestId, graph, groupingMode = 'component' } = event.data
  try {
    const layout = await elk.layout(toElkGraph(graph, groupingMode))
    self.postMessage({ requestId, status: 'ready', layout: fromElkLayout(layout, graph) })
  } catch (error) {
    self.postMessage({
      requestId,
      status: 'error',
      message: error instanceof Error ? error.message : 'Layout topology gagal.',
    })
  }
})

function toElkGraph(graph, groupingMode) {
  const groups = new Map()
  graph.nodes.forEach((node) => {
    const key = groupKey(node, groupingMode)
    if (!groups.has(key)) groups.set(key, groups.size)
  })
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '86',
      'elk.padding': '[top=56,left=56,bottom=56,right=56]',
      'elk.partitioning.activate': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: node.isCore ? 178 : 156,
      height: node.isCore ? 82 : 70,
      layoutOptions: {
        'elk.partitioning.partition': String(groups.get(groupKey(node, groupingMode))),
        ...(node.isCore ? { 'elk.layered.priority': '10' } : {}),
      },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.sourceId],
      targets: [edge.targetId],
    })),
  }
}

function groupKey(node, groupingMode) {
  if (groupingMode === 'network') return node.networkFamily ?? node.category ?? 'unmapped'
  if (groupingMode === 'building') return node.buildingId ?? node.componentId ?? node.id
  if (groupingMode === 'folder') return node.sourceFolderId ?? node.componentId ?? node.id
  return node.componentId ?? node.id
}

function fromElkLayout(layout, graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]))
  return {
    width: layout.width,
    height: layout.height,
    nodes: (layout.children ?? []).map((node) => ({
      ...nodeById.get(node.id),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })),
    edges: (layout.edges ?? []).map((edge) => ({
      ...edgeById.get(edge.id),
      sections: edge.sections ?? [],
    })),
  }
}
