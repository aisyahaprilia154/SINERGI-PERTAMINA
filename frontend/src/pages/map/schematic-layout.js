const DEFAULT_OPTIONS = {
  marginX: 58,
  headerHeight: 106,
  footerHeight: 112,
  nodeWidth: 124,
  nodeHeight: 64,
  columnGap: 72,
  rowGap: 34,
  minWidth: 760,
  maxTraceColumns: 6,
  mapWidth: 1100,
  mapContentHeight: 650,
}

export function calculateSchematicLayout(graph, options = {}) {
  if (graph.status !== 'ready') {
    return { status: graph.status, nodes: [], edges: [], width: 0, height: 0 }
  }

  const settings = { ...DEFAULT_OPTIONS, ...options }
  if (graph.mode === 'full-map' || graph.mode === 'all-assets') {
    return calculateCategorySectionLayout(graph, settings)
  }
  if (options.preserveMapOrientation && canUseSourcePositions(graph)) {
    return calculateMapRelativeLayout(graph, settings)
  }
  if (graph.mode === 'trace') return calculateTraceLayout(graph, settings)

  const depths = calculateDepths(graph)
  const groupedNodes = groupNodesByDepth(graph.nodes, depths)
  const maxRows = Math.max(...[...groupedNodes.values()].map((nodes) => nodes.length), 1)
  const columnCount = Math.max(groupedNodes.size, 1)
  const contentHeight = maxRows * settings.nodeHeight
    + Math.max(0, maxRows - 1) * settings.rowGap
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2
      + columnCount * settings.nodeWidth
      + Math.max(0, columnCount - 1) * settings.columnGap,
  )
  const height = settings.headerHeight + contentHeight + settings.footerHeight
  const nodeById = new Map()

  for (const [depth, nodes] of groupedNodes) {
    const groupHeight = nodes.length * settings.nodeHeight
      + Math.max(0, nodes.length - 1) * settings.rowGap
    const startY = settings.headerHeight + (contentHeight - groupHeight) / 2
    nodes.forEach((node, rowIndex) => {
      const x = settings.marginX + depth * (settings.nodeWidth + settings.columnGap)
      const y = startY + rowIndex * (settings.nodeHeight + settings.rowGap)
      nodeById.set(node.id, {
        ...node,
        depth,
        parentId: findParentId(node.id, depth, graph.edges, depths),
        diagram: {
          x,
          y,
          width: settings.nodeWidth,
          height: settings.nodeHeight,
          nodeX: x + settings.nodeWidth / 2,
          nodeY: y + 14,
          labelX: x + settings.nodeWidth / 2,
          labelY: y + 35,
        },
      })
    })
  }

  const laidOutEdges = layoutEdges(graph.edges, nodeById)

  return {
    status: 'ready',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: laidOutEdges,
  }
}

function calculateMapRelativeLayout(graph, settings) {
  const bounds = graph.sourceBounds || getNodeSourceBounds(graph.nodes)
  const width = Math.max(settings.minWidth, settings.mapWidth)
  const height = settings.headerHeight + settings.mapContentHeight + settings.footerHeight
  const horizontalPadding = settings.nodeWidth / 2 + 28
  const verticalPadding = 34
  const rangeX = Math.max(bounds.maxX - bounds.minX, .0001)
  const rangeY = Math.max(bounds.maxY - bounds.minY, .0001)
  const nodeById = new Map()

  graph.nodes.forEach((node) => {
    const normalizedX = (node.sourcePosition.x - bounds.minX) / rangeX
    const normalizedY = (node.sourcePosition.y - bounds.minY) / rangeY
    const nodeX = horizontalPadding
      + normalizedX * (width - horizontalPadding * 2)
    const nodeY = settings.headerHeight + verticalPadding
      + normalizedY * (settings.mapContentHeight - verticalPadding * 2)
    const x = nodeX - settings.nodeWidth / 2
    const y = nodeY - 14

    nodeById.set(node.id, {
      ...node,
      depth: null,
      parentId: null,
      diagram: {
        x,
        y,
        width: settings.nodeWidth,
        height: settings.nodeHeight,
        nodeX,
        nodeY,
        labelX: nodeX,
        labelY: y + 35,
      },
    })
  })

  return {
    status: 'ready',
    strategy: 'map-relative',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: layoutEdges(graph.edges, nodeById),
  }
}

function calculateCategorySectionLayout(graph, settings) {
  const categoryOrder = ['cctv', 'fiber-optic', 'lan', 'infrastructure', 'peripheral']
  const groups = new Map()
  graph.nodes.forEach((node) => {
    const category = node.category || 'infrastructure'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(node)
  })
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => {
    const leftOrder = categoryOrder.indexOf(left)
    const rightOrder = categoryOrder.indexOf(right)
    return (leftOrder < 0 ? categoryOrder.length : leftOrder)
      - (rightOrder < 0 ? categoryOrder.length : rightOrder)
      || left.localeCompare(right)
  })
  const largestGroupSize = Math.max(...orderedGroups.map(([, nodes]) => nodes.length), 1)
  const aspectRatio = 16 / 9
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(largestGroupSize * aspectRatio)))
  const horizontalGap = Math.max(settings.columnGap / 2, 28)
  const verticalGap = Math.max(settings.rowGap / 2, 18)
  const cellWidth = settings.nodeWidth + horizontalGap
  const cellHeight = settings.nodeHeight + verticalGap
  const sectionHeaderHeight = 54
  const sectionPadding = 24
  const sectionGap = 28
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2 + columnCount * cellWidth,
  )
  const nodeById = new Map()
  const sections = []
  let sectionY = settings.headerHeight

  orderedGroups.forEach(([category, nodes]) => {
    const sortedNodes = [...nodes].sort((left, right) => (
      compareSourcePosition(left, right)
      || String(left.name || '').localeCompare(String(right.name || ''), 'id')
      || left.id.localeCompare(right.id)
    ))
    const rowCount = Math.ceil(sortedNodes.length / columnCount)
    const sectionHeight = sectionHeaderHeight + rowCount * cellHeight + sectionPadding
    sections.push({
      category,
      nodeCount: sortedNodes.length,
      x: 32,
      y: sectionY,
      width: width - 64,
      height: sectionHeight,
    })
    sortedNodes.forEach((node, index) => {
      const column = index % columnCount
      const row = Math.floor(index / columnCount)
      const x = settings.marginX + column * cellWidth
      const y = sectionY + sectionHeaderHeight + row * cellHeight
      nodeById.set(node.id, {
        ...node,
        depth: null,
        parentId: null,
        diagram: {
          x,
          y,
          width: settings.nodeWidth,
          height: settings.nodeHeight,
          nodeX: x + settings.nodeWidth / 2,
          nodeY: y + 14,
          labelX: x + settings.nodeWidth / 2,
          labelY: y + 35,
        },
      })
    })
    sectionY += sectionHeight + sectionGap
  })

  const height = sectionY - sectionGap + settings.footerHeight
  return {
    status: 'ready',
    strategy: 'category-sections',
    width,
    height,
    options: settings,
    sections,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: layoutEdges(graph.edges, nodeById),
  }
}

function compareSourcePosition(left, right) {
  const leftPosition = left.sourcePosition
  const rightPosition = right.sourcePosition
  if (!leftPosition && !rightPosition) return 0
  if (!leftPosition) return 1
  if (!rightPosition) return -1
  return leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x
}

function canUseSourcePositions(graph) {
  return graph.nodes.length > 0
    && graph.nodes.every((node) =>
      Number.isFinite(node.sourcePosition?.x) && Number.isFinite(node.sourcePosition?.y),
    )
}

function getNodeSourceBounds(nodes) {
  const positions = nodes.map((node) => node.sourcePosition)
  return {
    minX: Math.min(...positions.map((position) => position.x)),
    maxX: Math.max(...positions.map((position) => position.x)),
    minY: Math.min(...positions.map((position) => position.y)),
    maxY: Math.max(...positions.map((position) => position.y)),
  }
}

function calculateTraceLayout(graph, settings) {
  const columnCount = Math.min(graph.nodes.length, settings.maxTraceColumns)
  const rowCount = Math.ceil(graph.nodes.length / columnCount)
  const width = Math.max(
    settings.minWidth,
    settings.marginX * 2
      + columnCount * settings.nodeWidth
      + Math.max(0, columnCount - 1) * settings.columnGap,
  )
  const contentHeight = rowCount * settings.nodeHeight
    + Math.max(0, rowCount - 1) * settings.rowGap
  const height = settings.headerHeight + contentHeight + settings.footerHeight
  const nodeById = new Map()

  graph.nodes.forEach((node, index) => {
    const row = Math.floor(index / columnCount)
    const positionInRow = index % columnCount
    const column = row % 2 === 0
      ? positionInRow
      : columnCount - 1 - positionInRow
    const x = settings.marginX + column * (settings.nodeWidth + settings.columnGap)
    const y = settings.headerHeight + row * (settings.nodeHeight + settings.rowGap)
    nodeById.set(node.id, {
      ...node,
      depth: index,
      parentId: index ? graph.nodes[index - 1].id : null,
      diagram: {
        x,
        y,
        width: settings.nodeWidth,
        height: settings.nodeHeight,
        nodeX: x + settings.nodeWidth / 2,
        nodeY: y + 14,
        labelX: x + settings.nodeWidth / 2,
        labelY: y + 35,
      },
    })
  })

  return {
    status: 'ready',
    width,
    height,
    options: settings,
    nodes: graph.nodes.map((node) => nodeById.get(node.id)),
    edges: layoutEdges(graph.edges, nodeById),
  }
}

function calculateDepths(graph) {
  if (graph.mode === 'trace') {
    return new Map(graph.nodes.map((node, index) => [node.id, index]))
  }

  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]))
  graph.edges.forEach((edge) => {
    adjacency.get(edge.sourceId)?.push(edge.targetId)
    adjacency.get(edge.targetId)?.push(edge.sourceId)
  })

  const anchorId = graph.anchorAssetId || graph.nodes[0]?.id
  const depths = new Map(anchorId ? [[anchorId, 0]] : [])
  const queue = anchorId ? [anchorId] : []

  while (queue.length) {
    const currentId = queue.shift()
    const currentDepth = depths.get(currentId)
    const neighbors = [...(adjacency.get(currentId) || [])].sort()
    neighbors.forEach((neighborId) => {
      if (depths.has(neighborId)) return
      depths.set(neighborId, currentDepth + 1)
      queue.push(neighborId)
    })
  }

  let disconnectedDepth = Math.max(...depths.values(), 0) + 1
  graph.nodes.forEach((node) => {
    if (!depths.has(node.id)) depths.set(node.id, disconnectedDepth++)
  })
  return depths
}

function groupNodesByDepth(nodes, depths) {
  const groups = new Map()
  nodes.forEach((node) => {
    const depth = depths.get(node.id) || 0
    if (!groups.has(depth)) groups.set(depth, [])
    groups.get(depth).push(node)
  })

  return new Map([...groups.entries()]
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .map(([depth, group]) => [
      depth,
      [...group].sort((left, right) =>
        Number(right.isAnchor) - Number(left.isAnchor)
        || left.category.localeCompare(right.category)
        || left.id.localeCompare(right.id),
      ),
    ]))
}

function findParentId(nodeId, depth, edges, depths) {
  if (depth === 0) return null
  const parentEdge = edges.find((edge) => {
    if (edge.sourceId === nodeId) return depths.get(edge.targetId) === depth - 1
    if (edge.targetId === nodeId) return depths.get(edge.sourceId) === depth - 1
    return false
  })
  if (!parentEdge) return null
  return parentEdge.sourceId === nodeId ? parentEdge.targetId : parentEdge.sourceId
}

function calculateRoutePoints(source, target) {
  if (!source || !target) return []
  const sourceRight = {
    x: source.diagram.nodeX,
    y: source.diagram.nodeY,
  }
  const sourceLeft = {
    x: source.diagram.nodeX,
    y: source.diagram.nodeY,
  }
  const targetRight = {
    x: target.diagram.nodeX,
    y: target.diagram.nodeY,
  }
  const targetLeft = {
    x: target.diagram.nodeX,
    y: target.diagram.nodeY,
  }

  if (source.diagram.x === target.diagram.x) {
    const routeX = source.diagram.x + source.diagram.width + 22
    return [
      sourceRight,
      { x: routeX, y: sourceRight.y },
      { x: routeX, y: targetRight.y },
      targetRight,
    ]
  }

  const forward = source.diagram.x <= target.diagram.x
  const start = forward ? sourceRight : sourceLeft
  const end = forward ? targetLeft : targetRight
  const middleX = (start.x + end.x) / 2

  if (Math.abs(start.y - end.y) < 1) return [start, end]
  return [
    start,
    { x: middleX, y: start.y },
    { x: middleX, y: end.y },
    end,
  ]
}

function layoutEdges(edges, nodeById) {
  const groups = new Map()
  edges.forEach((edge) => {
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(edge)
  })

  return edges.map((edge) => {
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    const parallelEdges = groups.get(key)
    const parallelIndex = parallelEdges.indexOf(edge)
    const laneOffset = (parallelIndex - (parallelEdges.length - 1) / 2) * 4
    const routePoints = calculateRoutePoints(
      nodeById.get(edge.sourceId),
      nodeById.get(edge.targetId),
    )
    return {
      ...edge,
      laneOffset,
      routePoints: offsetRoute(routePoints, laneOffset),
    }
  })
}

function offsetRoute(points, offset) {
  if (!offset || points.length < 2) return points
  const first = points[0]
  const second = points[1]
  const horizontalFirstSegment = first.y === second.y
  return points.map((point) => ({
    x: point.x + (horizontalFirstSegment ? 0 : offset),
    y: point.y + (horizontalFirstSegment ? offset : 0),
  }))
}
