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

test('map-relative layout preserves source orientation and a shared map frame', () => {
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
  const traceLayout = calculateSchematicLayout({
    ...mapGraph,
    mode: 'trace',
    nodes: [mapGraph.nodes[1]],
    edges: [],
  }, { preserveMapOrientation: true })

  const northWest = fullLayout.nodes.find((node) => node.id === 'north-west')
  const southEast = fullLayout.nodes.find((node) => node.id === 'south-east')

  assert.equal(fullLayout.strategy, 'map-relative')
  assert.ok(northWest.diagram.nodeX < southEast.diagram.nodeX)
  assert.ok(northWest.diagram.nodeY < southEast.diagram.nodeY)
  assert.equal(traceLayout.nodes[0].diagram.nodeX, southEast.diagram.nodeX)
  assert.equal(traceLayout.nodes[0].diagram.nodeY, southEast.diagram.nodeY)
})

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}
