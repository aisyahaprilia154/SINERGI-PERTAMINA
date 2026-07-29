const ROUTE_GAP = 18

/**
 * Routes already-confirmed graph edges. This module never creates topology
 * relations; it only calculates render-only orthogonal route points.
 */
export function routeOrthogonalEdges(edges, nodeById, {
  treeEdgeIds = new Set(),
  sectionByNodeId = new Map(),
  routeGap = ROUTE_GAP,
} = {}) {
  const parallelGroups = groupParallelEdges(edges)
  const cycleLaneBySection = new Map()
  const sectionNodes = groupNodesBySection(nodeById, sectionByNodeId)

  return edges.map((edge) => {
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) return { ...edge, routePoints: [], laneOffset: 0 }

    const parallelKey = edgePairKey(edge)
    const parallelEdges = parallelGroups.get(parallelKey)
    const parallelIndex = parallelEdges.indexOf(edge)
    const laneOffset = (parallelIndex - (parallelEdges.length - 1) / 2) * 4
    const isTreeEdge = treeEdgeIds.has(edge.id)
    let routePoints

    if (isTreeEdge) {
      routePoints = routeTreeEdge(source, target, laneOffset)
    } else {
      const sectionId = sectionByNodeId.get(source.id) || 'diagram'
      const lane = cycleLaneBySection.get(sectionId) || 0
      cycleLaneBySection.set(sectionId, lane + 1)
      routePoints = routeCycleEdge(source, target, lane, routeGap, laneOffset)
    }
    const sectionId = sectionByNodeId.get(source.id) || 'diagram'
    routePoints = chooseClearRoute({
      initialRoute: routePoints,
      source,
      target,
      nodes: sectionNodes.get(sectionId) || [...nodeById.values()],
      lane: cycleLaneBySection.get(sectionId) || 0,
      routeGap,
      laneOffset,
    })

    return {
      ...edge,
      laneOffset,
      routeKind: isTreeEdge ? 'tree' : 'cycle',
      routePoints,
    }
  })
}

function chooseClearRoute({
  initialRoute,
  source,
  target,
  nodes,
  lane,
  routeGap,
  laneOffset,
}) {
  const obstacles = nodes.filter(({ id }) => (
    id !== source.id && id !== target.id
  ))
  const bounds = nodeBounds(nodes)
  const candidates = [
    initialRoute,
    routeAroundBoundary(source, target, {
      side: 'top',
      coordinate: bounds.top - routeGap - lane * 10,
      laneOffset,
    }),
    routeAroundBoundary(source, target, {
      side: 'bottom',
      coordinate: bounds.bottom + routeGap + lane * 10,
      laneOffset,
    }),
    routeAroundBoundary(source, target, {
      side: 'left',
      coordinate: bounds.left - routeGap - lane * 10,
      laneOffset,
    }),
    routeAroundBoundary(source, target, {
      side: 'right',
      coordinate: bounds.right + routeGap + lane * 10,
      laneOffset,
    }),
  ]
  return candidates
    .map((points) => ({
      points,
      collisions: obstacles.filter((node) => (
        routeIntersectsNode(points, node)
      )).length,
      length: routeLength(points),
    }))
    .sort((left, right) => (
      left.collisions - right.collisions || left.length - right.length
    ))[0].points
}

function routeAroundBoundary(source, target, {
  side,
  coordinate,
  laneOffset,
}) {
  if (side === 'top' || side === 'bottom') {
    const sourceAnchor = side === 'top'
      ? source.diagram.anchorTop
      : source.diagram.anchorBottom
    const targetAnchor = side === 'top'
      ? target.diagram.anchorTop
      : target.diagram.anchorBottom
    return [
      { x: sourceAnchor.x + laneOffset, y: sourceAnchor.y },
      { x: sourceAnchor.x + laneOffset, y: coordinate },
      { x: targetAnchor.x + laneOffset, y: coordinate },
      { x: targetAnchor.x + laneOffset, y: targetAnchor.y },
    ]
  }
  const sourceAnchor = side === 'left'
    ? source.diagram.anchorLeft
    : source.diagram.anchorRight
  const targetAnchor = side === 'left'
    ? target.diagram.anchorLeft
    : target.diagram.anchorRight
  return [
    { x: sourceAnchor.x, y: sourceAnchor.y + laneOffset },
    { x: coordinate, y: sourceAnchor.y + laneOffset },
    { x: coordinate, y: targetAnchor.y + laneOffset },
    { x: targetAnchor.x, y: targetAnchor.y + laneOffset },
  ]
}

function routeTreeEdge(source, target, laneOffset) {
  if (Math.abs(source.diagram.nodeX - target.diagram.nodeX) < .5) {
    const upper = source.diagram.nodeY <= target.diagram.nodeY ? source : target
    const lower = upper === source ? target : source
    const start = {
      x: upper.diagram.anchorBottom.x + laneOffset,
      y: upper.diagram.anchorBottom.y,
    }
    const end = {
      x: lower.diagram.anchorTop.x + laneOffset,
      y: lower.diagram.anchorTop.y,
    }
    return orientRoute([start, end], source, upper)
  }
  const forward = source.diagram.nodeX <= target.diagram.nodeX
  const left = forward ? source : target
  const right = forward ? target : source
  const start = {
    x: left.diagram.anchorRight.x,
    y: left.diagram.anchorRight.y + laneOffset,
  }
  const end = {
    x: right.diagram.anchorLeft.x,
    y: right.diagram.anchorLeft.y + laneOffset,
  }
  if (Math.abs(start.y - end.y) < .5) return orientRoute([start, end], source, left)
  const middleX = (start.x + end.x) / 2
  return orientRoute([
    start,
    { x: middleX, y: start.y },
    { x: middleX, y: end.y },
    end,
  ], source, left)
}

function routeCycleEdge(source, target, lane, routeGap, laneOffset) {
  const sourceAboveTarget = source.diagram.nodeY <= target.diagram.nodeY
  const sourceAnchor = sourceAboveTarget
    ? source.diagram.anchorTop
    : source.diagram.anchorBottom
  const targetAnchor = sourceAboveTarget
    ? target.diagram.anchorTop
    : target.diagram.anchorBottom
  const direction = sourceAboveTarget ? -1 : 1
  const outsideY = direction < 0
    ? Math.min(source.diagram.y, target.diagram.y) - routeGap - lane * 10
    : Math.max(
      source.diagram.y + source.diagram.height,
      target.diagram.y + target.diagram.height,
    ) + routeGap + lane * 10
  return [
    { x: sourceAnchor.x + laneOffset, y: sourceAnchor.y },
    { x: sourceAnchor.x + laneOffset, y: outsideY },
    { x: targetAnchor.x + laneOffset, y: outsideY },
    { x: targetAnchor.x + laneOffset, y: targetAnchor.y },
  ]
}

function orientRoute(points, source, left) {
  return source.id === left.id ? points : [...points].reverse()
}

function groupParallelEdges(edges) {
  const groups = new Map()
  edges.forEach((edge) => {
    const key = edgePairKey(edge)
    groups.set(key, [...(groups.get(key) || []), edge])
  })
  return groups
}

function edgePairKey(edge) {
  return [edge.sourceId, edge.targetId].sort().join('|')
}

function groupNodesBySection(nodeById, sectionByNodeId) {
  const groups = new Map()
  nodeById.forEach((node, id) => {
    const sectionId = sectionByNodeId.get(id) || 'diagram'
    groups.set(sectionId, [...(groups.get(sectionId) || []), node])
  })
  return groups
}

function nodeBounds(nodes) {
  return {
    left: Math.min(...nodes.map(({ diagram }) => diagram.x)),
    right: Math.max(...nodes.map(({ diagram }) => diagram.x + diagram.width)),
    top: Math.min(...nodes.map(({ diagram }) => diagram.y)),
    bottom: Math.max(...nodes.map(({ diagram }) => diagram.y + diagram.height)),
  }
}

function routeLength(points) {
  return points.slice(1).reduce((total, point, index) => (
    total + Math.abs(point.x - points[index].x)
      + Math.abs(point.y - points[index].y)
  ), 0)
}

export function routeIntersectsNode(routePoints, node, tolerance = 1) {
  return routePoints.slice(1).some((point, index) => (
    segmentIntersectsRectangle(routePoints[index], point, node.diagram, tolerance)
  ))
}

function segmentIntersectsRectangle(start, end, rectangle, tolerance) {
  const left = rectangle.x + tolerance
  const right = rectangle.x + rectangle.width - tolerance
  const top = rectangle.y + tolerance
  const bottom = rectangle.y + rectangle.height - tolerance
  if (start.x === end.x) {
    return start.x > left && start.x < right
      && Math.max(start.y, end.y) > top
      && Math.min(start.y, end.y) < bottom
  }
  if (start.y === end.y) {
    return start.y > top && start.y < bottom
      && Math.max(start.x, end.x) > left
      && Math.min(start.x, end.x) < right
  }
  return false
}
