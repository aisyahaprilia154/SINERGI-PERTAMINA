// Only proper crossings between unrelated edges get a jump. Shared endpoints
// and collinear trunk segments retain their existing connectivity semantics.
export function lineJumpPaths(edges) {
  const paths = new Map()
  const segments = []
  for (const edge of edges) {
    const points = edge.routePoints ?? edge.linePoints ?? []
    const parts = points.length ? [`M ${points[0].x} ${points[0].y}`] : []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const horizontal = a.y === b.y
      const jumps = []
      for (const prior of segments) {
        if (prior.edge.sourceId === edge.sourceId || prior.edge.sourceId === edge.targetId
          || prior.edge.targetId === edge.sourceId || prior.edge.targetId === edge.targetId) continue
        if (horizontal === prior.horizontal) continue
        const x = horizontal ? prior.a.x : a.x
        const y = horizontal ? a.y : prior.a.y
        if (x <= Math.min(a.x, b.x) + (horizontal ? 16 : -1)
          || x >= Math.max(a.x, b.x) - (horizontal ? 16 : -1)
          || y <= Math.min(a.y, b.y) + (horizontal ? -1 : 16)
          || y >= Math.max(a.y, b.y) - (horizontal ? -1 : 16)) continue
        const coordinate = prior.horizontal ? x : y
        const low = prior.horizontal ? Math.min(prior.a.x, prior.b.x) : Math.min(prior.a.y, prior.b.y)
        const high = prior.horizontal ? Math.max(prior.a.x, prior.b.x) : Math.max(prior.a.y, prior.b.y)
        if (coordinate <= low + 7 || coordinate >= high - 7) continue
        jumps.push(horizontal ? x : y)
      }
      const sign = horizontal ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y)
      let last = -Infinity
      for (const c of [...new Set(jumps)].sort((x, y) => sign * (x - y))) {
        if (Math.abs(c - last) < 12) continue
        last = c
        if (horizontal) parts.push(`L ${c - sign * 5} ${a.y} Q ${c} ${a.y - 8} ${c + sign * 5} ${a.y}`)
        else parts.push(`L ${a.x} ${c - sign * 5} Q ${a.x + 8} ${c} ${a.x} ${c + sign * 5}`)
      }
      const next = points[i + 1]
      const incoming = Math.hypot(b.x - a.x, b.y - a.y)
      const outgoing = next ? Math.hypot(next.x - b.x, next.y - b.y) : 0
      // Stay within the routing clearance and never round a card's port.
      const radius = Math.min(8, incoming / 2, outgoing / 2)
      if (radius > 0 && (b.x - a.x) * (next.y - b.y) !== (b.y - a.y) * (next.x - b.x)) {
        const entry = {x: b.x - (b.x - a.x) / incoming * radius,
          y: b.y - (b.y - a.y) / incoming * radius}
        const exit = {x: b.x + (next.x - b.x) / outgoing * radius,
          y: b.y + (next.y - b.y) / outgoing * radius}
        parts.push(`L ${entry.x} ${entry.y} Q ${b.x} ${b.y} ${exit.x} ${exit.y}`)
      } else parts.push(`L ${b.x} ${b.y}`)
    }
    paths.set(edge.id, parts.join(' '))
    for (let i = 1; i < points.length; i++) segments.push({edge, a: points[i - 1], b: points[i], horizontal: points[i - 1].y === points[i].y})
  }
  return paths
}
