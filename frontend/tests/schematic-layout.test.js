import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSchematicLayout } from '../src/pages/map/schematic-layout.js'

const graph = {
  status: 'ready',
  mode: 'focus',
  anchorAssetId: 'core',
  nodes: [
    { id: 'core', category: 'infrastructure', isAnchor: true },
    { id: 'left', category: 'cctv', isAnchor: false },
    { id: 'right', category: 'fiber-optic', isAnchor: false },
    { id: 'leaf', category: 'cctv', isAnchor: false },
  ],
  edges: [
    { id: 'edge-1', sourceId: 'core', targetId: 'left' },
    { id: 'edge-2', sourceId: 'core', targetId: 'right' },
    { id: 'edge-3', sourceId: 'right', targetId: 'leaf' },
  ],
}

test('layout is deterministic and keeps the anchor at depth zero', () => {
  const first = calculateSchematicLayout(graph)
  const second = calculateSchematicLayout(graph)

  assert.deepEqual(first, second)
  assert.equal(first.nodes.find((node) => node.id === 'core').depth, 0)
  assert.equal(first.nodes.find((node) => node.id === 'leaf').depth, 2)
})

test('node rectangles do not overlap', () => {
  const layout = calculateSchematicLayout(graph)

  layout.nodes.forEach((node, index) => {
    layout.nodes.slice(index + 1).forEach((other) => {
      assert.equal(rectanglesOverlap(node.diagram, other.diagram), false)
    })
  })
})

test('edge routes use horizontal and vertical segments only', () => {
  const layout = calculateSchematicLayout(graph)

  layout.edges.forEach((edge) => {
    edge.routePoints.slice(1).forEach((point, index) => {
      const previous = edge.routePoints[index]
      assert.equal(
        previous.x === point.x || previous.y === point.y,
        true,
        `segment ${edge.id} must be orthogonal`,
      )
    })
  })
})

test('layout coordinates remain separate from graph nodes', () => {
  const snapshot = structuredClone(graph)
  const layout = calculateSchematicLayout(graph)

  assert.deepEqual(graph, snapshot)
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.diagram.x)))
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.diagram.nodeX)))
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.diagram.labelX)))
})

test('long traces wrap into deterministic rows while preserving sequence depth', () => {
  const traceNodes = Array.from({ length: 20 }, (_, index) => ({
    id: `trace-${index}`,
    category: 'cctv',
    isAnchor: index === 0,
  }))
  const traceGraph = {
    status: 'ready',
    mode: 'trace',
    anchorAssetId: 'trace-0',
    nodes: traceNodes,
    edges: traceNodes.slice(1).map((node, index) => ({
      id: `trace-edge-${index}`,
      sourceId: traceNodes[index].id,
      targetId: node.id,
    })),
  }
  const layout = calculateSchematicLayout(traceGraph)

  assert.ok(layout.width < 2000)
  assert.ok(new Set(layout.nodes.map((node) => node.diagram.y)).size > 1)
  assert.deepEqual(layout.nodes.map((node) => node.depth), traceNodes.map((_, index) => index))
})

test('parallel network relations receive separate visual lanes', () => {
  const parallelGraph = {
    status: 'ready',
    mode: 'network',
    anchorAssetId: 'source',
    nodes: [
      { id: 'source', category: 'infrastructure', isAnchor: true },
      { id: 'target', category: 'fiber-optic', isAnchor: false },
    ],
    edges: [
      { id: 'edge-a', sourceId: 'source', targetId: 'target' },
      { id: 'edge-b', sourceId: 'source', targetId: 'target' },
    ],
  }
  const layout = calculateSchematicLayout(parallelGraph)

  assert.deepEqual(layout.edges.map((edge) => edge.laneOffset), [-2, 2])
  assert.notDeepEqual(layout.edges[0].routePoints, layout.edges[1].routePoints)
})

test('selected relation with one neighbor keeps both cards and the edge inside final bounds', () => {
  const selectedGraph = {
    status: 'ready',
    mode: 'selected',
    anchorAssetId: 'focus',
    nodes: [
      { id: 'focus', name: 'JB-008-exp', type: 'Junction Box', category: 'cctv', isAnchor: true },
      { id: 'neighbor', name: 'JB-00X-exp', type: 'Junction Box', category: 'cctv', isAnchor: false },
    ],
    edges: [{ id: 'focus-neighbor', sourceId: 'focus', targetId: 'neighbor' }],
  }
  const layout = calculateSchematicLayout(selectedGraph)
  const focus = layout.nodes.find((node) => node.id === 'focus')
  const neighbor = layout.nodes.find((node) => node.id === 'neighbor')

  assert.equal(layout.nodes.length, 2)
  assert.equal(layout.edges.length, 1)
  assert.ok(neighbor.diagram.x > focus.diagram.x)
  assertBoundsContainLayout(layout)
  assert.deepEqual(layout.edges[0].routePoints[0], {
    x: focus.diagram.x + focus.diagram.width,
    y: focus.diagram.nodeY,
  })
  assert.deepEqual(layout.edges[0].routePoints.at(-1), {
    x: neighbor.diagram.x,
    y: neighbor.diagram.nodeY,
  })
})

test('full graph layout keeps every connected and isolated node available', () => {
  const nodes = Array.from({ length: 98 }, (_, index) => ({
    id: `asset-${index}`,
    name: `Asset ${index}`,
    type: index % 2 ? 'CCTV' : 'Junction Box',
    category: index % 2 ? 'cctv' : 'infrastructure',
  }))
  const edges = Array.from({ length: 46 }, (_, index) => ({
    id: `edge-${index}`,
    sourceId: `asset-${index}`,
    targetId: `asset-${index + 1}`,
  }))
  const layout = calculateSchematicLayout({
    status: 'ready',
    mode: 'all-assets',
    nodes,
    edges,
  })

  assert.equal(layout.nodes.length, 98)
  assert.equal(layout.edges.length, 46)
  assert.equal(layout.sections.find((section) => section.kind === 'isolated').nodeCount, 51)
  assert.ok(layout.sections.filter((section) => section.kind === 'connected').length > 0)
  assert.ok(layout.width > layout.options.minWidth)
  assert.equal(layout.defaultZoom, .62)
  assertBoundsContainLayout(layout)
})

test('full-map layout creates readable category sections', () => {
  const mapGraph = {
    status: 'ready',
    mode: 'full-map',
    sourceBounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    nodes: [
      { id: 'north-west', sourcePosition: { x: .1, y: .1 } },
      { id: 'south-east', sourcePosition: { x: .9, y: .9 } },
    ],
    edges: [{ id: 'map-edge', sourceId: 'north-west', targetId: 'south-east' }],
  }
  const fullLayout = calculateSchematicLayout(mapGraph, { preserveMapOrientation: true })
  const northWest = fullLayout.nodes.find((node) => node.id === 'north-west')
  const southEast = fullLayout.nodes.find((node) => node.id === 'south-east')

  assert.equal(fullLayout.strategy, 'category-sections')
  assert.equal(fullLayout.sections.length, 1)
  assert.equal(fullLayout.sections[0].nodeCount, 2)
  assert.ok(northWest.diagram.nodeX < southEast.diagram.nodeX)
  assert.equal(rectanglesOverlap(northWest.diagram, southEast.diagram), false)
})

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

function assertBoundsContainLayout(layout) {
  layout.nodes.forEach((node) => {
    assert.ok(node.diagram.x >= layout.bounds.minX)
    assert.ok(node.diagram.y >= layout.bounds.minY)
    assert.ok(node.diagram.x + node.diagram.width <= layout.bounds.maxX)
    assert.ok(node.diagram.y + node.diagram.height <= layout.bounds.maxY)
  })
  layout.edges.forEach((edge) => edge.routePoints.forEach((point) => {
    assert.ok(point.x >= layout.bounds.minX)
    assert.ok(point.y >= layout.bounds.minY)
    assert.ok(point.x <= layout.bounds.maxX)
    assert.ok(point.y <= layout.bounds.maxY)
  }))
}
