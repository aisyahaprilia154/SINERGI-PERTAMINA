import { routeTopologyEdges, countOrthogonalCrossings } from './topology-edge-router.js'
import { buildTopologyHierarchy } from './topology-hierarchy.js'
import { placeTopologyNode } from './topology-label-placement.js'

const DEFAULTS = {
  marginX: 34,
  marginY: 36,
  headerHeight: 118,
  footerHeight: 74,
  nodeWidth: 150,
  nodeHeight: 50,
  columnGap: 72,
  rowGap: 18,
  minWidth: 760,
  maxTraceColumns: 8,
}

export function calculateTopologyLayout(graph, options = {}) {
  if (graph.status !== 'ready') return { status: graph.status, nodes: [], edges: [], width: 0, height: 0 }
  const settings = { ...DEFAULTS, ...options }
  if (graph.mode === 'trace') return calculateTraceLayout(graph, settings)
  const hierarchy = buildTopologyHierarchy(graph, options)
  const byId = new Map(hierarchy.nodes.map((node) => [node.id, node]))
  const leaves = hierarchy.nodes.filter((node) => !node.childIds.length)
    .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))
  const yById = new Map()
  leaves.forEach((node, index) => yById.set(node.id, settings.headerHeight + index * (settings.nodeHeight + settings.rowGap)))
  const assignParentY = (id) => {
    if (yById.has(id)) return yById.get(id)
    const node = byId.get(id)
    const childYs = node?.childIds.map(assignParentY).filter(Number.isFinite) || []
    const y = childYs.length ? (Math.min(...childYs) + Math.max(...childYs)) / 2 : settings.headerHeight
    yById.set(id, y)
    return y
  }
  assignParentY(hierarchy.rootId)
  const maxDepth = Math.max(...hierarchy.nodes.map((node) => node.depth), 0)
  const contentHeight = Math.max(settings.nodeHeight, leaves.length * (settings.nodeHeight + settings.rowGap) - settings.rowGap)
  const width = Math.max(settings.minWidth, settings.marginX * 2 + (maxDepth + 1) * settings.nodeWidth + maxDepth * settings.columnGap)
  const height = settings.headerHeight + contentHeight + settings.footerHeight
  const nodes = hierarchy.nodes.map((node) => {
    const x = settings.marginX + node.depth * (settings.nodeWidth + settings.columnGap)
    const y = yById.get(node.id)
    return placeTopologyNode({ node, x, y, width: settings.nodeWidth, height: settings.nodeHeight })
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = routeTopologyEdges(hierarchy.edges, nodeById)
  return {
    status: 'ready',
    strategy: 'hierarchy',
    nodes,
    edges,
    sections: [],
    width,
    height,
    crossings: countOrthogonalCrossings(edges),
    bounds: { x: 0, y: 0, width, height },
    options: settings,
  }
}

function calculateTraceLayout(graph, settings) {
  const columns = Math.min(settings.maxTraceColumns, graph.nodes.length)
  const rows = Math.ceil(graph.nodes.length / columns)
  const width = Math.max(settings.minWidth, settings.marginX * 2 + columns * settings.nodeWidth + (columns - 1) * settings.columnGap)
  const height = settings.headerHeight + rows * settings.nodeHeight + Math.max(0, rows - 1) * settings.rowGap + settings.footerHeight
  const nodes = graph.nodes.map((node, index) => {
    const row = Math.floor(index / columns)
    const position = index % columns
    const col = row % 2 ? columns - 1 - position : position
    const x = settings.marginX + col * (settings.nodeWidth + settings.columnGap)
    const y = settings.headerHeight + row * (settings.nodeHeight + settings.rowGap)
    return placeTopologyNode({ node: {
      ...node,
      depth: index,
      parentId: index ? graph.nodes[index - 1].id : null,
    }, x, y, width: settings.nodeWidth, height: settings.nodeHeight })
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const hierarchyEdges = graph.edges.map((edge) => ({ ...edge, isTreeEdge: true }))
  const edges = routeTopologyEdges(hierarchyEdges, nodeById)
  return { status: 'ready', strategy: 'trace', nodes, edges, sections: [], width, height, crossings: countOrthogonalCrossings(edges), bounds: { x: 0, y: 0, width, height }, options: settings }
}

export function calculateFitScale({ viewportWidth, viewportHeight, contentWidth, contentHeight, padding = 24 }) {
  if (!viewportWidth || !viewportHeight || !contentWidth || !contentHeight) return 1
  return Math.max(.55, Math.min(1, (viewportWidth - padding * 2) / contentWidth, (viewportHeight - padding * 2) / contentHeight))
}
