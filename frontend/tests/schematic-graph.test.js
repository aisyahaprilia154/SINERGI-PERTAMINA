import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSchematicGraph } from '../src/pages/map/schematic-graph.js'

const assets = [
  { id: 'core', name: 'SW-CORE-01', type: 'Core switch', location: 'Server', ip: '10.42.0.1', longitude: 110, latitude: -7 },
  { id: 'jb', name: 'JB-CCTV-01', type: 'Junction box', location: 'Koridor', longitude: 111, latitude: -7.1 },
  { id: 'cam', name: 'CCTV-GATE-01', type: 'CCTV', location: 'Gerbang', longitude: 112, latitude: -7.2 },
  { id: 'printer', name: 'PRN-FIN-01', type: 'Printer', location: 'Finance', longitude: 113, latitude: -7.3 },
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
    scope: 'trace',
  })

  assert.equal(graph.mode, 'trace')
  assert.equal(graph.anchorAssetId, 'cam')
  assert.deepEqual(graph.nodes.map((node) => node.id), ['cam', 'jb', 'core'])
  assert.deepEqual(graph.edges.map((edge) => [edge.sourceId, edge.targetId]), [
    ['cam', 'jb'],
    ['jb', 'core'],
  ])
})

test('focused asset selects its complete connected component', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    focusedAssetId: 'jb',
  })

  assert.equal(graph.mode, 'network')
  assert.deepEqual(new Set(graph.nodes.map((node) => node.id)), new Set(['core', 'jb', 'cam', 'printer']))
  assert.equal(graph.edges.length, 3)
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

test('diagram excludes inferred topology edges that are not confirmed', () => {
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

  assert.equal(graph.status, 'empty')
  assert.deepEqual(graph.edges, [])
})

test('builder returns the required empty state when a scope has no confirmed edge', () => {
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

  assert.equal(graph.status, 'empty')
  assert.equal(graph.nodeCount, 31)
  assert.match(graph.message, /belum ada relasi yang telah dikonfirmasi/)
})

test('builder never writes diagram coordinates into source assets', () => {
  const snapshot = structuredClone(assets)
  const graph = buildSchematicGraph({ assets, networks, focusedAssetId: 'core' })

  assert.equal(graph.status, 'ready')
  assert.deepEqual(assets, snapshot)
  assert.equal('x' in assets[0], false)
  assert.equal('diagram' in assets[0], false)
})

test('legacy full-map request resolves to one connected network component', () => {
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

  assert.equal(graph.mode, 'network')
  assert.deepEqual(
    new Set(graph.nodes.map((node) => node.id)),
    new Set(['core', 'jb', 'cam', 'printer']),
  )
  assert.equal(graph.nodes[0].sourcePosition, undefined)
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
