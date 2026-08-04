export function routeTopologyEdges(edges, nodeById) {
  const pairCount = new Map()
  edges.forEach((edge) => {
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    pairCount.set(key, (pairCount.get(key) || 0) + 1)
  })
  const pairIndex = new Map()
  let cycleIndex = 0
  return edges.map((edge) => {
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) return { ...edge, routePoints: [] }
    const parent = source.depth <= target.depth ? source : target
    const child = parent === source ? target : source
    const key = [edge.sourceId, edge.targetId].sort().join('|')
    const index = pairIndex.get(key) || 0
    pairIndex.set(key, index + 1)
    const laneOffset = (index - (pairCount.get(key) - 1) / 2) * 4
    let start = { x: parent.diagram.x + parent.diagram.width, y: parent.diagram.y + parent.diagram.height / 2 + laneOffset }
    let end = { x: child.diagram.x, y: child.diagram.y + child.diagram.height / 2 + laneOffset }
    let routePoints
    if (edge.isCycleEdge) {
      start = { x: source.diagram.x + source.diagram.width / 2, y: source.diagram.y }
      end = { x: target.diagram.x + target.diagram.width / 2, y: target.diagram.y }
      const outerY = Math.min(...[...nodeById.values()].map((node) => node.diagram.y)) - 14 - cycleIndex * 10
      cycleIndex += 1
      routePoints = [start, { x: start.x, y: outerY }, { x: end.x, y: outerY }, end]
    } else if (child.depth <= parent.depth) {
      const outerY = Math.min(start.y, end.y) - 34 - index * 8
      routePoints = [start, { x: start.x + 24, y: start.y }, { x: start.x + 24, y: outerY }, { x: end.x - 24, y: outerY }, { x: end.x - 24, y: end.y }, end]
    } else {
      const trunkX = Math.round((start.x + end.x) / 2)
      routePoints = [start, { x: trunkX, y: start.y }, { x: trunkX, y: end.y }, end]
    }
    return { ...edge, laneOffset, routePoints }
  })
}

export function countOrthogonalCrossings(edges = []) {
  const segments = edges.flatMap((edge) => edge.routePoints.slice(1).map((point, index) => ({
    edgeId: edge.id,
    a: edge.routePoints[index],
    b: point,
  })))
  let count = 0
  segments.forEach((left, index) => segments.slice(index + 1).forEach((right) => {
    if (left.edgeId === right.edgeId) return
    const leftHorizontal = left.a.y === left.b.y
    const rightHorizontal = right.a.y === right.b.y
    if (leftHorizontal === rightHorizontal) return
    const horizontal = leftHorizontal ? left : right
    const vertical = leftHorizontal ? right : left
    const minX = Math.min(horizontal.a.x, horizontal.b.x)
    const maxX = Math.max(horizontal.a.x, horizontal.b.x)
    const minY = Math.min(vertical.a.y, vertical.b.y)
    const maxY = Math.max(vertical.a.y, vertical.b.y)
    if (vertical.a.x > minX && vertical.a.x < maxX && horizontal.a.y > minY && horizontal.a.y < maxY) count += 1
  }))
  return count
}
