import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateFitScale } from '../src/pages/map/schematic-bounds.js'
import { routeIntersectsNode } from '../src/pages/map/schematic-edge-routing.js'
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

test('source positions never override the hierarchical TopologyGraph layout', () => {
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

  assert.equal(fullLayout.strategy, 'hierarchical-layered')
  assert.ok(northWest.diagram.nodeX < southEast.diagram.nodeX)
  assert.notDeepEqual(northWest.sourcePosition, northWest.diagram)
  assert.notDeepEqual(southEast.sourcePosition, southEast.diagram)
})

test('linear graph is arranged upstream to downstream from left to right', () => {
  const linear = fixtureGraph({
    nodeIds: ['upstream', 'switch', 'downstream'],
    edges: [
      ['upstream', 'switch'],
      ['switch', 'downstream'],
    ],
    anchorAssetId: 'upstream',
  })
  const layout = calculateSchematicLayout(linear)
  const positions = Object.fromEntries(layout.nodes.map((node) => [
    node.id,
    node.diagram.nodeX,
  ]))

  assert.ok(positions.upstream < positions.switch)
  assert.ok(positions.switch < positions.downstream)
})

test('branched graph keeps leaf nodes near their parent lane', () => {
  const branched = fixtureGraph({
    nodeIds: ['core', 'branch-a', 'branch-b', 'leaf-a', 'leaf-b'],
    edges: [
      ['core', 'branch-a'],
      ['core', 'branch-b'],
      ['branch-a', 'leaf-a'],
      ['branch-b', 'leaf-b'],
    ],
    anchorAssetId: 'core',
  })
  const layout = calculateSchematicLayout(branched)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))

  assert.equal(byId.get('branch-a').parentId, 'core')
  assert.equal(byId.get('branch-b').parentId, 'core')
  assert.equal(byId.get('leaf-a').parentId, 'branch-a')
  assert.equal(byId.get('leaf-b').parentId, 'branch-b')
})

test('multiple connected components are rendered in separate sections', () => {
  const multiple = fixtureGraph({
    nodeIds: ['a', 'b', 'c', 'd'],
    edges: [['a', 'b'], ['c', 'd']],
  })
  const layout = calculateSchematicLayout(multiple)
  const components = layout.sections.filter(({ kind }) => kind === 'connected-component')

  assert.equal(components.length, 2)
  assert.ok(components[0].bounds.y + components[0].bounds.height
    < components[1].bounds.y)
})

test('cycle edge uses a compact orthogonal loop lane', () => {
  const cycle = fixtureGraph({
    nodeIds: ['a', 'b', 'c'],
    edges: [['a', 'b'], ['b', 'c'], ['c', 'a']],
    anchorAssetId: 'a',
  })
  const layout = calculateSchematicLayout(cycle)
  const loop = layout.edges.find(({ routeKind }) => routeKind === 'cycle')

  assert.ok(loop)
  assert.ok(loop.routePoints.length >= 4)
  loop.routePoints.slice(1).forEach((point, index) => {
    const previous = loop.routePoints[index]
    assert.ok(previous.x === point.x || previous.y === point.y)
  })
})

test('virtual junction is compact and never rendered as an inventory-sized node', () => {
  const virtual = fixtureGraph({
    nodes: [
      fixtureNode('a'),
      {
        ...fixtureNode('virtual-junction:1'),
        type: 'Virtual junction',
        isVirtual: true,
        isConnector: true,
      },
      fixtureNode('b'),
    ],
    edges: [['a', 'virtual-junction:1'], ['virtual-junction:1', 'b']],
  })
  const layout = calculateSchematicLayout(virtual)
  const junction = layout.nodes.find(({ isVirtual }) => isVirtual)

  assert.equal(junction.diagram.width, 32)
  assert.equal(junction.diagram.height, 32)
  assert.deepEqual(junction.labelLines, [])
})

test('many isolated nodes become a separate aggregate instead of polluting the network', () => {
  const isolated = fixtureGraph({
    nodeIds: Array.from({ length: 14 }, (_, index) => `isolated-${index}`),
    edges: [],
  })
  const layout = calculateSchematicLayout(isolated)

  assert.equal(layout.sections.length, 1)
  assert.equal(layout.sections[0].kind, 'isolated')
  assert.equal(layout.nodes.length, 1)
  assert.equal(layout.nodes[0].isIsolatedAggregate, true)
  assert.equal(layout.nodes[0].memberCount, 14)
})

test('edge route does not pass through an unrelated node on a simple fixture', () => {
  const branched = fixtureGraph({
    nodeIds: ['core', 'left', 'right'],
    edges: [['core', 'left'], ['core', 'right']],
    anchorAssetId: 'core',
  })
  const layout = calculateSchematicLayout(branched)
  const edge = layout.edges.find(({ targetId }) => targetId === 'left')
  const unrelated = layout.nodes.find(({ id }) => id === 'right')

  assert.equal(routeIntersectsNode(edge.routePoints, unrelated), false)
})

test('resolved duplicate short labels remain distinct and never fall back to stable IDs', () => {
  const duplicateLabels = fixtureGraph({
    nodes: [
      { ...fixtureNode('src:long-stable-a'), shortLabel: 'JB-002 · A' },
      { ...fixtureNode('src:long-stable-b'), shortLabel: 'JB-002 · B' },
    ],
    edges: [['src:long-stable-a', 'src:long-stable-b']],
    anchorAssetId: 'src:long-stable-a',
  })
  const layout = calculateSchematicLayout(duplicateLabels)

  assert.deepEqual(
    layout.nodes.map(({ labelLines }) => labelLines.join(' ')),
    ['JB-002 · A', 'JB-002 · B'],
  )
  assert.ok(layout.nodes.every(({ labelLines }) => (
    !labelLines.join(' ').includes('src:')
  )))
})

test('fit scale uses actual diagram bounds and remains within zoom limits', () => {
  assert.equal(calculateFitScale({
    bounds: { width: 1000, height: 500 },
    viewportWidth: 500,
    viewportHeight: 300,
    padding: 0,
  }), .5)
  assert.equal(calculateFitScale({
    bounds: { width: 100, height: 100 },
    viewportWidth: 2000,
    viewportHeight: 1200,
  }), 2.5)
})

test('compact mode lays out 31 to 100 nodes without overlapping cards', () => {
  const nodeIds = Array.from({ length: 48 }, (_, index) => `node-${index}`)
  const compact = fixtureGraph({
    nodeIds,
    edges: nodeIds.slice(1).map((id, index) => [nodeIds[index], id]),
  })
  compact.layoutDensity = 'compact'
  const layout = calculateSchematicLayout(compact)

  assert.equal(layout.strategy, 'hierarchical-layered')
  assert.equal(layout.nodes.length, 48)
  layout.nodes.forEach((node, index) => {
    layout.nodes.slice(index + 1).forEach((other) => {
      assert.equal(rectanglesOverlap(node.diagram, other.diagram), false)
    })
  })
})

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

function fixtureGraph({
  nodeIds = [],
  nodes = null,
  edges = [],
  anchorAssetId = nodeIds[0] || nodes?.[0]?.id,
}) {
  const fixtureNodes = nodes || nodeIds.map(fixtureNode)
  return {
    status: 'ready',
    mode: 'focus',
    title: 'Fixture graph',
    anchorAssetId,
    nodes: fixtureNodes.map((node) => ({
      ...node,
      isAnchor: node.id === anchorAssetId,
    })),
    edges: edges.map(([sourceId, targetId], index) => ({
      id: `edge-${index}`,
      sourceId,
      targetId,
      networkName: 'Fixture',
      networkColor: '#9698f4',
      relationSource: 'explicit',
    })),
  }
}

function fixtureNode(id) {
  return {
    id,
    shortLabel: id,
    name: id,
    type: id === 'core' ? 'Core switch' : 'CCTV',
    category: id === 'core' ? 'infrastructure' : 'cctv',
    isConnector: id === 'core',
  }
}
