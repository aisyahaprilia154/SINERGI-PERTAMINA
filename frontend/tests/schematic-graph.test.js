import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildScopedGraph,
  buildSchematicGraph,
  segmentSchematicGraph,
} from '../src/pages/map/schematic-graph.js'

const assets = [
  { id: 'core', name: 'SW-CORE-01', type: 'Core switch', location: 'Server', ip: '10.42.0.1', coordinate: [110, -7] },
  { id: 'jb', name: 'JB-CCTV-01', type: 'Junction box', location: 'Koridor', coordinate: [111, -7.1] },
  { id: 'cam', name: 'CCTV-GATE-01', type: 'CCTV', location: 'Gerbang', coordinate: [112, -7.2] },
  { id: 'printer', name: 'PRN-FIN-01', type: 'Printer', location: 'Finance', coordinate: [113, -7.3] },
]
const networks = [
  {
    id: 'cctv',
    name: 'CCTV Ring',
    shortName: 'CCTV Ring',
    type: 'CCTV',
    nodeIds: ['core', 'jb', 'cam'],
    edges: [['core', 'jb'], ['jb', 'cam']],
  },
  {
    id: 'peripheral',
    name: 'Peripheral',
    shortName: 'Peripheral',
    type: 'Peripheral',
    nodeIds: ['core', 'printer'],
    edges: [['core', 'printer']],
  },
]

test('trace has priority and preserves its explicit connection order', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    selectedNetworkIds: ['peripheral'],
    focusedAssetId: 'printer',
    tracePath: ['cam', 'jb', 'core'],
    traceRelations: [
      { networkId: 'cctv', relationType: 'explicit-network-edge' },
      { networkId: 'cctv', relationType: 'explicit-network-edge' },
    ],
  })

  assert.equal(graph.mode, 'trace')
  assert.equal(graph.anchorAssetId, 'cam')
  assert.deepEqual(graph.nodes.map((node) => node.id), ['cam', 'jb', 'core'])
  assert.deepEqual(graph.edges.map((edge) => [edge.sourceId, edge.targetId]), [
    ['cam', 'jb'],
    ['jb', 'core'],
  ])
})

test('focused asset graph contains only its direct explicit relations', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    focusedAssetId: 'jb',
  })

  assert.equal(graph.mode, 'focus')
  assert.deepEqual(new Set(graph.nodes.map((node) => node.id)), new Set(['core', 'jb', 'cam']))
  assert.equal(graph.edges.length, 2)
  assert.equal(graph.nodes.some((node) => node.id === 'printer'), false)
})

test('selected network graph excludes assets from unselected networks', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    selectedNetworkIds: ['peripheral'],
  })

  assert.equal(graph.mode, 'network')
  assert.deepEqual(new Set(graph.nodes.map((node) => node.id)), new Set(['core', 'printer']))
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.nodes.find((node) => node.id === 'core').ip, '10.42.0.1')
})

test('diagram uses the same confirmed topology edges as tracing and map', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    topologyGraph: {
      nodes: assets.map(({ id }) => ({ id })),
      edges: [{
        id: 'topology-core-camera',
        sourceNodeId: 'core',
        targetNodeId: 'cam',
        networkId: 'cctv',
        relationType: 'line-endpoint',
        relationSource: 'inferred_endpoint',
      }],
    },
    focusedAssetId: 'core',
  })

  assert.deepEqual(graph.edges.map(({ sourceId, targetId }) => [sourceId, targetId]), [
    ['core', 'cam'],
  ])
  assert.equal(graph.edges[0].relationSource, 'inferred_endpoint')
})

test('scoped graph expands a confirmed topology path through its virtual junction', () => {
  const topologyGraph = {
    nodes: [{ id: 'core' }, { id: 'cam' }],
    edges: [{
      id: 'collapsed-intersection',
      sourceNodeId: 'core',
      targetNodeId: 'cam',
      networkId: 'cctv',
      relationType: 'line-intersection',
      relationSource: 'inferred_intersection',
      relationStatus: 'confirmed_inferred',
      sourceGeometryIds: ['line-a', 'line-b'],
    }],
    virtualJunctions: [{
      id: 'virtual-junction:fixture',
      coordinate: [110, -7],
      isVirtual: true,
    }],
    internalEdges: [
      {
        sourceNodeId: 'core',
        targetNodeId: 'virtual-junction:fixture',
        sourceGeometryId: 'line-a',
        relationSource: 'inferred_intersection',
      },
      {
        sourceNodeId: 'virtual-junction:fixture',
        targetNodeId: 'cam',
        sourceGeometryId: 'line-b',
        relationSource: 'inferred_intersection',
      },
    ],
  }
  const snapshot = structuredClone(topologyGraph)
  const graph = buildScopedGraph({
    assets,
    networks,
    topologyGraph,
    scope: 'selected-network',
    selectedNetworkIds: ['cctv'],
  })

  assert.equal(graph.nodes.find(({ id }) => (
    id === 'virtual-junction:fixture'
  ))?.isVirtual, true)
  assert.deepEqual(
    graph.edges.map(({ sourceId, targetId }) => [sourceId, targetId]),
    [
      ['core', 'virtual-junction:fixture'],
      ['virtual-junction:fixture', 'cam'],
    ],
  )
  assert.deepEqual(topologyGraph, snapshot)
})

test('builder uses compact layout metadata for 31 to 100 nodes', () => {
  const manyAssets = Array.from({ length: 31 }, (_, index) => ({
    id: `asset-${index}`,
    name: `Asset ${index}`,
    type: 'CCTV',
  }))
  const graph = buildSchematicGraph({
    assets: manyAssets,
    networks: [{
      id: 'large',
      name: 'Large network',
      nodeIds: manyAssets.map((asset) => asset.id),
      edges: [],
    }],
    selectedNetworkIds: ['large'],
  })

  assert.equal(graph.status, 'ready')
  assert.equal(graph.layoutDensity, 'compact')
  assert.equal(graph.nodes.length, 31)
})

test('scope above 100 nodes returns actionable simplification choices', () => {
  const manyAssets = Array.from({ length: 1376 }, (_, index) => ({
    id: `asset-${index}`,
    name: `Asset ${index}`,
    type: 'CCTV',
  }))
  const graph = buildSchematicGraph({
    assets: manyAssets,
    networks: [{
      id: 'large',
      name: 'Large network',
      nodeIds: manyAssets.map((asset) => asset.id),
      edges: [],
    }],
    scope: 'full-map',
  })

  assert.equal(graph.status, 'scope-required')
  assert.equal(graph.nodeCount, 1376)
  assert.equal(graph.message, '1376 aset ditemukan. Pilih cara penyederhanaan diagram.')
  assert.deepEqual(graph.availableActions, [
    'overview-pengapon',
    'current-viewport',
    'selected-network',
    'active-trace',
    'multi-page',
  ])
})

test('builder never writes diagram coordinates into source assets', () => {
  const snapshot = structuredClone(assets)
  const graph = buildSchematicGraph({ assets, networks, focusedAssetId: 'core' })

  assert.equal(graph.status, 'ready')
  assert.deepEqual(assets, snapshot)
  assert.equal('x' in assets[0], false)
  assert.equal('diagram' in assets[0], false)
})

test('full-map scope includes every active network and preserves map display positions separately', () => {
  const positionedAssets = assets.map((asset, index) => ({
    ...asset,
    x: index / assets.length,
    y: (assets.length - index) / assets.length,
  }))
  const graph = buildSchematicGraph({
    assets: positionedAssets,
    networks,
    scope: 'full-map',
    tracePath: ['cam', 'jb'],
  })

  assert.equal(graph.mode, 'full-map')
  assert.deepEqual(
    new Set(graph.nodes.map((node) => node.id)),
    new Set(['core', 'jb', 'cam', 'printer']),
  )
  assert.deepEqual(graph.nodes[0].sourcePosition, {
    x: positionedAssets[0].x,
    y: positionedAssets[0].y,
  })
  assert.equal('diagram' in positionedAssets[0], false)
})

test('trace scope returns a clear empty state before tracing exists', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    scope: 'trace',
  })

  assert.equal(graph.status, 'empty')
  assert.equal(graph.mode, 'trace')
  assert.match(graph.message, /Jalankan tracing/)
})

test('focus depth two follows the shared topology graph without including unrelated nodes', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    focusedAssetId: 'cam',
    focusDepth: 2,
    scope: 'focus',
  })

  assert.deepEqual(
    new Set(graph.nodes.map(({ id }) => id)),
    new Set(['cam', 'jb', 'core']),
  )
  assert.equal(graph.nodes.some(({ id }) => id === 'printer'), false)
})

test('viewport uses geographic Canvas bounds and layer scope selects its assets', () => {
  const scopedAssets = assets.map((asset, index) => ({
    ...asset,
    x: index / 10,
    y: index / 10,
    layerId: index < 2 ? 'layer-a' : 'layer-b',
  }))
  const viewportGraph = buildSchematicGraph({
    assets: scopedAssets,
    networks,
    geometries: [
      geometry('viewport-crossing-line', 'line_string', [[109, -7], [112, -7]]),
    ],
    scope: 'current-viewport',
    viewportBounds: { west: 109.9, east: 111.1, south: -7.11, north: -6.9 },
  })
  const layerGraph = buildSchematicGraph({
    assets: scopedAssets,
    networks,
    geometries: [
      geometry('layer-b-line', 'line_string', [[111, -7.1], [112, -7.2]], 'layer-b'),
    ],
    scope: 'layer',
    selectedLayerIds: ['layer-b'],
  })

  assert.deepEqual(viewportGraph.nodes.map(({ id }) => id), ['core', 'jb'])
  assert.ok(viewportGraph.representedGeometryIds.includes('viewport-crossing-line'))
  assert.deepEqual(layerGraph.nodes.map(({ id }) => id), ['cam', 'printer'])
  assert.deepEqual(layerGraph.representedGeometryIds, ['layer-b-line'])
})

test('overview includes Fiber Optic and LAN networks that only contain LineString geometry', () => {
  const lineOnlyNetworks = [
    ...networks,
    {
      id: 'fiber-optic',
      name: 'Jaringan Fiber Optic',
      shortName: 'Fiber Optic',
      type: 'Fiber Optic',
      nodeIds: [],
      geometryIds: ['fo-line'],
      lineCount: 1,
      edges: [],
      displayBounds: { minX: .1, maxX: .8, minY: .2, maxY: .3 },
    },
    {
      id: 'lan',
      name: 'Jaringan LAN',
      shortName: 'LAN',
      type: 'LAN',
      nodeIds: [],
      geometryIds: ['lan-line'],
      lineCount: 1,
      edges: [],
      displayBounds: { minX: .2, maxX: .7, minY: .5, maxY: .6 },
    },
  ]
  const graph = buildSchematicGraph({
    assets,
    networks: lineOnlyNetworks,
    geometries: [
      geometry('fo-line', 'line_string', [[110, -7], [111, -7.1]]),
      geometry('lan-line', 'line_string', [[111, -7.1], [112, -7.2]]),
    ],
    scope: 'overview-pengapon',
  })

  const fiber = graph.nodes.find(({ groupId }) => groupId === 'fiber-optic')
  const lan = graph.nodes.find(({ groupId }) => groupId === 'lan')
  assert.equal(fiber.groupType, 'network-aggregate')
  assert.equal(fiber.nodeCount, 0)
  assert.equal(fiber.lineCount, 1)
  assert.deepEqual(fiber.representedGeometryIds, ['fo-line'])
  assert.equal(lan.groupType, 'network-aggregate')
  assert.equal(lan.nodeCount, 0)
  assert.equal(lan.lineCount, 1)

  const selectedFiber = buildSchematicGraph({
    assets,
    networks: lineOnlyNetworks,
    geometries: [
      geometry('fo-line', 'line_string', [[110, -7], [111, -7.1]]),
    ],
    scope: 'selected-network',
    selectedNetworkIds: ['fiber-optic'],
  })
  assert.equal(selectedFiber.status, 'ready')
  assert.equal(selectedFiber.nodes[0].groupType, 'network-aggregate')
  assert.deepEqual(selectedFiber.representedGeometryIds, ['fo-line'])
})

test('focused depth traversal is cycle-safe and stops at the requested depth', () => {
  const topologyGraph = {
    nodes: assets.map(({ id }) => ({ id })),
    edges: [
      topologyEdge('core', 'jb'),
      topologyEdge('jb', 'cam'),
      topologyEdge('cam', 'core'),
      topologyEdge('core', 'printer'),
    ],
  }
  const depthOne = buildSchematicGraph({
    assets,
    networks,
    topologyGraph,
    focusedAssetId: 'jb',
    focusDepth: 1,
    scope: 'focused-asset-depth-1',
  })
  const depthTwo = buildSchematicGraph({
    assets,
    networks,
    topologyGraph,
    focusedAssetId: 'jb',
    focusDepth: 2,
    scope: 'focused-asset-depth-2',
  })

  assert.deepEqual(new Set(depthOne.representedNodeIds), new Set(['jb', 'core', 'cam']))
  assert.equal(depthOne.representedNodeIds.includes('printer'), false)
  assert.deepEqual(
    new Set(depthTwo.representedNodeIds),
    new Set(['jb', 'core', 'cam', 'printer']),
  )
})

test('overview represents networks as group nodes instead of every asset label', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    scope: 'overview',
  })

  assert.equal(graph.status, 'ready')
  assert.equal(graph.mode, 'overview')
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.representedAssetCount, 4)
  assert.ok(graph.nodes.every(({ isGroup, detailScopeKey }) => isGroup && detailScopeKey))
  assert.equal(graph.edges.length, 1)
})

test('multi-page segmentation keeps every node within configurable page size', () => {
  const manyAssets = Array.from({ length: 65 }, (_, index) => ({
    id: `asset-${index}`,
    name: `Asset ${index}`,
    type: 'CCTV',
  }))
  const completeGraph = buildSchematicGraph({
    assets: manyAssets,
    networks: [{
      id: 'large',
      name: 'Large network',
      nodeIds: manyAssets.map(({ id }) => id),
      edges: [],
    }],
    scope: 'full-map',
    compactMaxNodes: Number.POSITIVE_INFINITY,
  })
  const segmented = segmentSchematicGraph(completeGraph, { pageSize: 30 })

  assert.equal(segmented.pageCount, 3)
  assert.deepEqual(segmented.pages.map(({ nodes }) => nodes.length), [30, 30, 5])
  assert.equal(
    new Set(segmented.pages.flatMap(({ nodes }) => nodes.map(({ id }) => id))).size,
    65,
  )
  assert.equal(segmented.segmentationStrategy, 'connected-component-then-network')
  assert.equal(segmented.indexSummary.pageCount, 3)
})

function geometry(id, geometryType, coordinates, layerId = null) {
  return { id, geometryType, coordinates, layerId }
}

function topologyEdge(sourceNodeId, targetNodeId) {
  return {
    id: `edge:${sourceNodeId}:${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
    relationType: 'connected-to',
    relationSource: 'explicit',
    relationStatus: 'confirmed',
  }
}

test('active tracing is not truncated by the detail page limit', () => {
  const traceAssets = Array.from({ length: 40 }, (_, index) => ({
    id: `trace-${index}`,
    name: `Trace ${index}`,
    type: 'Switch',
  }))
  const tracePath = traceAssets.map(({ id }) => id)
  const graph = buildSchematicGraph({
    assets: traceAssets,
    networks: [],
    scope: 'active-trace',
    tracePath,
    traceRelations: tracePath.slice(1).map((_, index) => ({
      relationType: 'connected-to',
      sourceGeometryId: `trace-geometry-${index}`,
    })),
  })

  assert.equal(graph.status, 'ready')
  assert.equal(graph.nodes.length, 40)
  assert.equal(graph.edges.length, 39)
  assert.equal(graph.pathGeometryIds.length, 39)
})
