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

test('builder keeps the complete branch scope without an arbitrary asset limit', () => {
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
  assert.equal(graph.nodes.length, 31)
})

test('builder never writes diagram coordinates into source assets', () => {
  const snapshot = structuredClone(assets)
  const graph = buildSchematicGraph({ assets, networks, focusedAssetId: 'core' })

  assert.equal(graph.status, 'ready')
  assert.deepEqual(assets, snapshot)
  assert.equal('x' in assets[0], false)
  assert.equal('diagram' in assets[0], false)
})

test('selected relation mode contains the focus and every direct confirmed neighbor', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    topologyGraph: {
      nodes: assets.map(({ id }) => ({ id })),
      edges: [
        { id: 'jb-core', sourceNodeId: 'jb', targetNodeId: 'core', relationStatus: 'confirmed' },
        { id: 'jb-cam', sourceNodeId: 'jb', targetNodeId: 'cam', relationStatus: 'confirmed' },
        { id: 'core-printer', sourceNodeId: 'core', targetNodeId: 'printer', relationStatus: 'confirmed' },
      ],
    },
    focusedAssetId: 'jb',
    scope: 'selected',
  })

  assert.equal(graph.mode, 'selected')
  assert.equal(graph.anchorAssetId, 'jb')
  assert.deepEqual(new Set(graph.nodes.map((node) => node.id)), new Set(['jb', 'core', 'cam']))
  assert.equal(graph.edges.length, 2)
  assert.equal(graph.neighborCount, 2)
})

test('selected relation mode excludes neighbors of neighbors and pending edges', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    topologyGraph: {
      nodes: assets.map(({ id }) => ({ id })),
      edges: [
        { id: 'jb-core', sourceNodeId: 'jb', targetNodeId: 'core', relationStatus: 'confirmed' },
        { id: 'core-printer', sourceNodeId: 'core', targetNodeId: 'printer', relationStatus: 'confirmed' },
        { id: 'jb-pending', sourceNodeId: 'jb', targetNodeId: 'cam', relationStatus: 'inferred_pending' },
      ],
    },
    focusedAssetId: 'jb',
    scope: 'selected',
  })

  assert.deepEqual(graph.nodes.map((node) => node.id), ['jb', 'core'])
  assert.deepEqual(graph.edges.map(({ sourceId, targetId }) => [sourceId, targetId]), [['jb', 'core']])
})

test('JB-010-exp selected relation graph contains all four direct relations', () => {
  const sampleAssets = [
    { id: 'jb-010', name: 'JB-010-exp', type: 'Junction Box' },
    { id: 'jb-011-1', name: 'JB-011.1-exp', type: 'Junction Box' },
    { id: 't-021', name: 'T-021', type: 'Tiang' },
    { id: 'jb-011', name: 'JB-011-exp', type: 'Junction Box' },
    { id: 'jb-012', name: 'JB-012', type: 'Junction Box' },
    { id: 'cctv-20', name: 'CCTV-20', type: 'CCTV' },
  ]
  const graph = buildSchematicGraph({
    assets: sampleAssets,
    networks: [{ id: 'cctv', name: 'Jaringan CCTV', nodeIds: sampleAssets.map(({ id }) => id), edges: [] }],
    topologyGraph: {
      nodes: sampleAssets.map(({ id }) => ({ id })),
      edges: [
        { id: 'jb-010-jb-011-1', sourceNodeId: 'jb-010', targetNodeId: 'jb-011-1', relationStatus: 'confirmed' },
        { id: 'jb-010-t-021', sourceNodeId: 'jb-010', targetNodeId: 't-021', relationStatus: 'confirmed' },
        { id: 'jb-010-jb-011', sourceNodeId: 'jb-010', targetNodeId: 'jb-011', relationStatus: 'confirmed' },
        { id: 'jb-010-jb-012', sourceNodeId: 'jb-010', targetNodeId: 'jb-012', relationStatus: 'confirmed' },
        { id: 'jb-011-cctv-20', sourceNodeId: 'jb-011', targetNodeId: 'cctv-20', relationStatus: 'confirmed' },
      ],
    },
    focusedAssetId: 'jb-010',
    scope: 'selected',
  })

  assert.equal(graph.mode, 'selected')
  assert.equal(graph.anchorAssetId, 'jb-010')
  assert.equal(graph.nodes.length, 5)
  assert.equal(graph.edges.length, 4)
  assert.deepEqual(new Set(graph.nodes.map((node) => node.name)), new Set([
    'JB-010-exp',
    'JB-011.1-exp',
    'T-021',
    'JB-011-exp',
    'JB-012',
  ]))
  assert.equal(graph.nodes.some((node) => node.name === 'CCTV-20'), false)
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

test('all-assets scope includes isolated assets outside the confirmed topology graph', () => {
  const graph = buildSchematicGraph({
    assets,
    networks,
    topologyGraph: {
      nodes: [{ id: 'core' }, { id: 'jb' }, { id: 'cam' }],
      edges: [{
        id: 'topology-core-jb',
        sourceNodeId: 'core',
        targetNodeId: 'jb',
        networkId: 'cctv',
      }],
    },
    scope: 'all-assets',
  })

  assert.equal(graph.mode, 'all-assets')
  assert.deepEqual(new Set(graph.nodes.map((node) => node.id)), new Set(assets.map(({ id }) => id)))
  assert.deepEqual(graph.edges.map(({ sourceId, targetId }) => [sourceId, targetId]), [['core', 'jb']])
  assert.equal(graph.title, 'Seluruh aset')
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
