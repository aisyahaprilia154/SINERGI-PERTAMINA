import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyGraph } from '../src/domain/topology-builder.js'

test('explicit relation has priority and is confirmed', () => {
  const input = topologyInput({
    assets: [
      asset('node-a', 'A', 'Infrastructure', 'Switch'),
      asset('node-b', 'B', 'Infrastructure', 'Switch'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
    ],
    relations: [{
      id: 'relation-a-b',
      sourceAssetId: 'A',
      targetAssetId: 'B',
      relationType: 'connected-to',
    }],
  })
  const snapshot = structuredClone(input)

  const graph = buildTopologyGraph(input)

  assert.deepEqual(input, snapshot)
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].relationSource, 'explicit')
  assert.equal(graph.edges[0].relationStatus, 'confirmed')
})

test('explicit metadata aliases create confirmed relations and unresolved targets stay diagnostic', () => {
  const source = asset('node-a', 'A', 'Infrastructure', 'Switch')
  source.properties.extendedData = {
    connectedTo: 'B, MISSING',
    relation_type: 'uplink',
  }
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      source,
      asset('node-b', 'B', 'Infrastructure', 'Server'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
    ],
  }))

  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].relationSource, 'explicit')
  assert.equal(graph.edges[0].relationType, 'uplink')
  assert.ok(graph.unresolvedEndpoints.some((diagnostic) => (
    diagnostic.kind === 'explicit_relation'
      && diagnostic.targetAssetId === 'MISSING'
      && diagnostic.reason === 'explicit_reference_not_found'
  )))
})

test('line endpoints snap with geographic tolerance and create one edge', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-b', 'B', 'LAN', 'Access Point'),
      asset('node-line', 'LAN-01', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      line('line-1', 'node-line', [[110.00001, -7], [110.00099, -7]]),
    ],
  }))

  assert.equal(graph.edges.length, 1)
  assert.deepEqual(edgePair(graph.edges[0]), ['A', 'B'])
  assert.equal(graph.edges[0].relationSource, 'inferred_endpoint')
  assert.equal(graph.edges[0].relationStatus, 'confirmed_inferred')
  assert.equal(graph.edges[0].sourceGeometryId, 'line-1')
  assert.ok(graph.edges[0].distanceMeters < 5)
})

test('line endpoints outside tolerance remain unresolved', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-line', 'LAN-01', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 111, -7),
      line('line-1', 'node-line', [[110, -7], [110.001, -7]]),
    ],
  }))

  assert.equal(graph.edges.length, 0)
  assert.equal(graph.unresolvedEndpoints.length, 2)
  assert.ok(graph.unresolvedEndpoints.every(
    ({ reason }) => reason === 'no_candidate_within_tolerance',
  ))
})

test('nearly equal endpoint candidates are ambiguous and never confirmed', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-b', 'B', 'LAN', 'Switch'),
      asset('node-end', 'END', 'LAN', 'Access Point'),
      asset('node-line', 'LAN-01', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 110.00001, -7),
      point('point-b', 'node-b', 109.99999, -7),
      point('point-end', 'node-end', 110.001, -7),
      line('line-1', 'node-line', [[110, -7], [110.001, -7]]),
    ],
  }))

  assert.equal(graph.ambiguousConnections.length, 1)
  assert.equal(graph.ambiguousConnections[0].kind, 'line_endpoint')
  assert.deepEqual(
    graph.ambiguousConnections[0].candidates.map(({ nodeId }) => nodeId).sort(),
    ['A', 'B'],
  )
  assert.equal(graph.edges.length, 0)
})

test('point on line splits the topology path without changing source geometry', () => {
  const input = topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-mid', 'MID', 'Peripheral', 'Access Point'),
      asset('node-b', 'B', 'LAN', 'Switch'),
      asset('node-line', 'LAN-01', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-mid', 'node-mid', 110.0005, -7.000005),
      point('point-b', 'node-b', 110.001, -7),
      line('line-1', 'node-line', [[110, -7], [110.001, -7]]),
    ],
  })
  const snapshot = structuredClone(input)

  const graph = buildTopologyGraph(input)

  assert.deepEqual(input, snapshot)
  assert.deepEqual(graph.edges.map(edgePair).sort(), [
    ['A', 'MID'],
    ['B', 'MID'],
  ])
  assert.ok(graph.edges.every(
    ({ relationSource }) => relationSource === 'inferred_point_on_line',
  ))
})

test('intersecting compatible lines create internal virtual junction connectivity', () => {
  const input = topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-b', 'B', 'LAN', 'Switch'),
      asset('node-c', 'C', 'LAN', 'Switch'),
      asset('node-d', 'D', 'LAN', 'Switch'),
      asset('node-line-1', 'LINE-1', 'LAN', 'LAN cable'),
      asset('node-line-2', 'LINE-2', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      point('point-c', 'node-c', 110.0005, -7.0005),
      point('point-d', 'node-d', 110.0005, -6.9995),
      line('line-1', 'node-line-1', [[110, -7], [110.001, -7]]),
      line('line-2', 'node-line-2', [[110.0005, -7.0005], [110.0005, -6.9995]]),
    ],
  })
  const graph = buildTopologyGraph(input)
  const reloaded = buildTopologyGraph(structuredClone(input))

  assert.equal(graph.virtualJunctions.length, 1)
  assert.equal(graph.virtualJunctions[0].id, reloaded.virtualJunctions[0].id)
  assert.equal(graph.connectedComponents.length, 1)
  assert.equal(graph.connectedComponents[0].nodeIds.length, 4)
  assert.ok(graph.edges.some(
    ({ relationSource }) => relationSource === 'inferred_intersection',
  ))
  assert.ok(graph.virtualJunctions.every(
    ({ id }) => !graph.nodes.some((node) => node.id === id),
  ))
})

test('cross-site explicit relations are rejected before becoming confirmed edges', () => {
  const nodeA = {
    ...asset('node-a', 'A', 'Infrastructure', 'Switch'),
    siteScopeId: 'pengapon',
    datasetVersionId: 'version-1',
  }
  const nodeB = {
    ...asset('node-b', 'B', 'Infrastructure', 'Server'),
    siteScopeId: 'rewulu',
    datasetVersionId: 'version-1',
  }
  const graph = buildTopologyGraph({
    ...topologyInput({
      assets: [nodeA, nodeB],
      geometries: [
        point('point-a', 'node-a', 110, -7),
        point('point-b', 'node-b', 110.001, -7),
      ],
      relations: [relation('A', 'B')],
    }),
    siteScopeId: 'pengapon',
    datasetVersionId: 'version-1',
  })

  assert.equal(graph.edges.length, 0)
  assert.ok(graph.unresolvedEndpoints.some(
    ({ reason }) => reason === 'cross_site_relation_rejected',
  ))
})

test('incompatible node and line categories are not inferred', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-camera', 'CAM-1', 'CCTV', 'CCTV'),
      asset('node-printer', 'PRN-1', 'Peripheral', 'Printer'),
      asset('node-line', 'FO-1', 'Fiber Optic', 'Fiber Optic line'),
    ],
    geometries: [
      point('point-camera', 'node-camera', 110, -7),
      point('point-printer', 'node-printer', 110.001, -7),
      line('line-fo', 'node-line', [[110, -7], [110.001, -7]]),
    ],
  }))

  assert.equal(graph.edges.length, 0)
  assert.equal(graph.unresolvedEndpoints.length, 2)
})

test('explicit and inferred copies of the same edge are deduplicated', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-b', 'B', 'LAN', 'Switch'),
      asset('node-line', 'LAN-01', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      line('line-1', 'node-line', [[110, -7], [110.001, -7]]),
    ],
    relations: [{
      id: 'explicit-a-b',
      sourceAssetId: 'A',
      targetAssetId: 'B',
      relationType: 'connected-to',
    }],
  }))

  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].id, 'explicit-a-b')
  assert.equal(graph.edges[0].relationSource, 'explicit')
})

test('persisted inferred records are recomputed from source geometry instead of promoted to explicit', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-a', 'A', 'LAN', 'Switch'),
      asset('node-b', 'B', 'Peripheral', 'Access Point'),
      asset('node-line', 'LAN-01', 'LAN', 'LAN cable'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      line('line-1', 'node-line', [[110, -7], [110.001, -7]]),
    ],
    relations: [{
      ...relation('A', 'B'),
      relationSource: 'inferred_endpoint',
      relationStatus: 'confirmed_inferred',
    }],
  }))

  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].relationSource, 'inferred_endpoint')
  assert.equal(graph.edges[0].relationStatus, 'confirmed_inferred')
})

test('connected component traversal is cycle-safe', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [
      asset('node-a', 'A', 'Infrastructure', 'Switch'),
      asset('node-b', 'B', 'Infrastructure', 'Switch'),
      asset('node-c', 'C', 'Infrastructure', 'Switch'),
    ],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      point('point-c', 'node-c', 110.002, -7),
    ],
    relations: [
      relation('A', 'B'),
      relation('B', 'C'),
      relation('C', 'A'),
    ],
  }))

  assert.equal(graph.edges.length, 3)
  assert.equal(graph.connectedComponents.length, 1)
  assert.deepEqual(graph.connectedComponents[0].nodeIds, ['A', 'B', 'C'])
  assert.equal(graph.adjacency.A.length, 2)
  assert.equal(graph.adjacency.B.length, 2)
  assert.equal(graph.adjacency.C.length, 2)
})

test('isolated Point node remains in graph diagnostics', () => {
  const graph = buildTopologyGraph(topologyInput({
    assets: [asset('node-alone', 'ALONE', 'CCTV', 'CCTV')],
    geometries: [point('point-alone', 'node-alone', 110, -7)],
  }))

  assert.equal(graph.nodes.length, 1)
  assert.deepEqual(graph.isolatedNodes, ['ALONE'])
  assert.equal(graph.connectedComponents.length, 1)
  assert.deepEqual(graph.connectedComponents[0].edgeIds, [])
})

function topologyInput({
  assets = [],
  geometries = [],
  relations = [],
} = {}) {
  return { assets, geometries, relations, layers: [] }
}

function asset(id, assetId, category, type) {
  return {
    id,
    assetId,
    name: assetId,
    category,
    type,
    layerId: 'layer-1',
    properties: {},
  }
}

function point(id, assetNodeId, longitude, latitude) {
  return {
    id,
    assetNodeId,
    geometryType: 'point',
    coordinates: [longitude, latitude],
  }
}

function line(id, assetNodeId, coordinates) {
  return {
    id,
    assetNodeId,
    geometryType: 'line_string',
    coordinates,
  }
}

function relation(sourceAssetId, targetAssetId) {
  return {
    id: `relation-${sourceAssetId}-${targetAssetId}`,
    sourceAssetId,
    targetAssetId,
    relationType: 'connected-to',
  }
}

function edgePair(edge) {
  return [edge.sourceNodeId, edge.targetNodeId].sort()
}
