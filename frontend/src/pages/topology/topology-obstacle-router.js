// Orthogonal routing on a visibility grid. Cards are obstacles, including
// cards unrelated to the current edge; endpoint ports remain on card borders.
export function routeSchematicEdges(nodes, edges, mountingBoxes = []) {
  const clearance = 12
  const portLead = 16
  const frameByNode = new Map(mountingBoxes.flatMap(frame =>
    (frame.nodeIds ?? []).map(id => [id, frame])))
  const boxes = new Map(nodes.map(node => [node.id, {
    left: node.diagram.x, right: node.diagram.x + node.diagram.width,
    top: node.diagram.y, bottom: node.diagram.y + node.diagram.height,
  }]))
  const ports = []
  const portGroups = new Map()
  for (const edge of edges) {
    const a = boxes.get(edge.sourceId), b = boxes.get(edge.targetId)
    if (!a || !b) continue
    const dx = (b.left + b.right - a.left - a.right) / 2
    const dy = (b.top + b.bottom - a.top - a.bottom) / 2
    const vertical = Math.abs(dy) > 40
    const sides = vertical ? (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'])
      : (dx > 0 ? ['right', 'left'] : ['left', 'right'])
    const pair = [edge.sourceId, edge.targetId].map((id, i) => {
      const key = `${id}:${sides[i]}`
      const port = {id, side: sides[i], other: i ? a : b, otherId: i ? edge.sourceId : edge.targetId}
      if (!portGroups.has(key)) portGroups.set(key, [])
      portGroups.get(key).push(port)
      return port
    })
    ports.push({edge, pair})
  }
  const obstacles = [...boxes.values(), ...mountingBoxes.map(box => ({
    left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + 36,
  }))]
  const xs = new Set(), ys = new Set()
  for (const box of obstacles) {
    xs.add(box.left - clearance); xs.add(box.right + clearance)
    ys.add(box.top - clearance); ys.add(box.bottom + clearance)
  }
  for (const group of portGroups.values()) {
    const vertical = ['top', 'bottom'].includes(group[0].side)
    group.sort((a, b) => (vertical
      ? a.other.left - b.other.left : a.other.top - b.other.top) || a.otherId.localeCompare(b.otherId))
    group.forEach((port, index) => {
      const box = boxes.get(port.id)
      const span = vertical ? box.right - box.left - 40 : box.bottom - box.top - 24
      const offset = (index - (group.length - 1) / 2) * Math.min(20, span / Math.max(1, group.length - 1))
      const fraction = 0.5 + offset / span
      port.border = vertical
        ? {x: box.left + 20 + (box.right - box.left - 40) * fraction, y: box[port.side]}
        : {x: box[port.side], y: box.top + 12 + (box.bottom - box.top - 24) * fraction}
      port.outer = {...port.border}
      if (vertical) port.outer.y += port.side === 'top' ? -portLead : portLead
      else port.outer.x += port.side === 'left' ? -portLead : portLead
      xs.add(port.outer.x); ys.add(port.outer.y)
    })
  }
  const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b)
  const nx = x.length, ny = y.length, size = nx * ny
  if (!size) return edges
  const xi = new Map(x.map((value, i) => [value, i]))
  const yi = new Map(y.map((value, i) => [value, i]))
  const horizontal = new Uint8Array(size), vertical = new Uint8Array(size)
  // Rasterize open obstacle interiors; travelling along the clearance boundary
  // is safe. Each cell records the segment toward its right/bottom neighbor.
  for (const box of obstacles) {
    const left = xi.get(box.left - clearance), right = xi.get(box.right + clearance)
    const top = yi.get(box.top - clearance), bottom = yi.get(box.bottom + clearance)
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const cell = row * nx + col
        if (row > top && row < bottom && col < right) horizontal[cell] = 1
        if (col > left && col < right && row < bottom) vertical[cell] = 1
      }
    }
  }
  const result = new Map()
  for (const {edge, pair: [start, end]} of ports) {
    // Prefer a single, centered elbow corridor before searching the grid.
    // This gives sibling branches a consistent shape instead of hugging cards.
    const a = start.outer, b = end.outer
    const midY = (a.y + b.y) / 2, midX = (a.x + b.x) / 2
    const candidates = [
      [a, {x: a.x, y: midY}, {x: b.x, y: midY}, b],
      [a, {x: midX, y: a.y}, {x: midX, y: b.y}, b],
    ]
    const sourceFrame = frameByNode.get(start.id), targetFrame = frameByNode.get(end.id)
    if (sourceFrame && targetFrame && sourceFrame.id !== targetFrame.id
      && ['top', 'bottom'].includes(start.side) && ['top', 'bottom'].includes(end.side)) {
      // Repeated parent/child installations use the same outside-frame lane.
      // Never let the shortest-path search choose a different elbow per JB.
      const right = Math.max(sourceFrame.x + sourceFrame.width,
        targetFrame.x + targetFrame.width) + 24
      const left = Math.min(sourceFrame.x, targetFrame.x) - 24
      candidates.unshift(...[right, left].map(laneX => [a,
        {x: laneX, y: a.y}, {x: laneX, y: b.y}, b]))
    }
    const clear = points => points.slice(1).every((q, i) => {
      const p = points[i]
      return obstacles.every(r => p.x === q.x
        ? !(p.x > r.left - clearance && p.x < r.right + clearance
          && Math.max(p.y, q.y) > r.top - clearance && Math.min(p.y, q.y) < r.bottom + clearance)
        : !(p.y > r.top - clearance && p.y < r.bottom + clearance
          && Math.max(p.x, q.x) > r.left - clearance && Math.min(p.x, q.x) < r.right + clearance))
    })
    const direct = candidates.find(clear)
    if (direct) {
      result.set(edge.id, simplify([start.border, ...direct, end.border]))
      continue
    }
    const source = yi.get(start.outer.y) * nx + xi.get(start.outer.x)
    const target = yi.get(end.outer.y) * nx + xi.get(end.outer.x)
    const distance = new Float64Array(size * 3).fill(Infinity)
    const previous = new Int32Array(size * 3).fill(-1)
    const heap = new MinHeap()
    distance[source * 3] = 0
    heap.push(source * 3, 0)
    let goal = -1
    while (heap.items.length) {
      const {state, cost} = heap.pop()
      const cell = Math.floor(state / 3), direction = state % 3
      const row = Math.floor(cell / nx), col = cell % nx
      const heuristic = Math.abs(x[col] - end.outer.x) + Math.abs(y[row] - end.outer.y)
      if (cost > distance[state] + heuristic + 0.001) continue
      if (cell === target) { goal = state; break }
      const neighbors = []
      if (col + 1 < nx && !horizontal[cell]) neighbors.push([cell + 1, 1, x[col + 1] - x[col]])
      if (col > 0 && !horizontal[cell - 1]) neighbors.push([cell - 1, 1, x[col] - x[col - 1]])
      if (row + 1 < ny && !vertical[cell]) neighbors.push([cell + nx, 2, y[row + 1] - y[row]])
      if (row > 0 && !vertical[cell - nx]) neighbors.push([cell - nx, 2, y[row] - y[row - 1]])
      for (const [next, nextDirection, length] of neighbors) {
        const nextState = next * 3 + nextDirection
        const nextCost = distance[state] + length
          + (direction && direction !== nextDirection ? 48 : 0)
        if (nextCost >= distance[nextState]) continue
        distance[nextState] = nextCost
        previous[nextState] = state
        heap.push(nextState, nextCost + Math.abs(x[next % nx] - end.outer.x)
          + Math.abs(y[Math.floor(next / nx)] - end.outer.y))
      }
    }
    if (goal < 0) throw new Error(`Tidak ada jalur bebas kartu untuk ${edge.id}`)
    const cells = []
    for (let state = goal; state >= 0; state = previous[state]) cells.push(Math.floor(state / 3))
    cells.reverse()
    const points = [start.border, ...cells.map(cell => ({x: x[cell % nx], y: y[Math.floor(cell / nx)]})), end.border]
    result.set(edge.id, simplify(points))
  }
  return edges.map(edge => ({...edge, routePoints: result.get(edge.id) ?? edge.routePoints}))
}

function simplify(points) {
  const result = []
  for (const point of points) {
    const last = result.at(-1), before = result.at(-2)
    if (last && last.x === point.x && last.y === point.y) continue
    if (before && ((before.x === last.x && last.x === point.x)
      || (before.y === last.y && last.y === point.y))) result.pop()
    result.push(point)
  }
  return result
}

class MinHeap {
  items = []
  push(state, cost) {
    const item = {state, cost}
    let index = this.items.length
    this.items.push(item)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.items[parent].cost <= cost) break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = item
  }
  pop() {
    const first = this.items[0], last = this.items.pop()
    if (!this.items.length) return first
    let index = 0
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1
      if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++
      if (this.items[child].cost >= last.cost) break
      this.items[index] = this.items[child]
      index = child
    }
    this.items[index] = last
    return first
  }
}
