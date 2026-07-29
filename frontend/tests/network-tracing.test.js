import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExplicitRelationGraph,
  findReachableDestinations,
  findTracePath,
  getConnectedAssets,
} from '../src/pages/map/network-tracing.js'

const assetIds = ['a', 'b', 'c', 'd', 'nearby']
const graph = buildExplicitRelationGraph({
  assetIds,
  networks: [{
    id: 'explicit-network',
    edges: [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']],
  }],
})

test('graph only contains explicit relations and never infers proximity', () => {
  assert.deepEqual(getConnectedAssets(graph, 'a').map((item) => item.targetAssetId), ['b', 'c'])
  assert.deepEqual(getConnectedAssets(graph, 'nearby'), [])
})

test('graph retains AssetRelation identity and type from the active dataset', () => {
  const relationGraph = buildExplicitRelationGraph({
    assetIds: ['camera', 'switch'],
    networks: [{
      id: 'layer:cctv',
      edges: [['camera', 'switch']],
      relations: [{
        id: 'relation-1',
        sourceAssetId: 'camera',
        targetAssetId: 'switch',
        relationType: 'connected_to',
        pathAssetId: 'cable-1',
      }],
    }],
  })
  const [relation] = getConnectedAssets(relationGraph, 'camera')

  assert.equal(relation.id, 'relation-1')
  assert.equal(relation.relationType, 'connected_to')
  assert.equal(relation.pathAssetId, 'cable-1')
})

test('tracing consumes confirmed edges from the shared topology graph', () => {
  const relationGraph = buildExplicitRelationGraph({
    assetIds: ['camera', 'junction', 'switch'],
    networks: [],
    topologyGraph: {
      edges: [{
        id: 'topology-camera-junction',
        sourceNodeId: 'camera',
        targetNodeId: 'junction',
        relationType: 'line-endpoint',
        relationSource: 'inferred_endpoint',
        relationStatus: 'confirmed',
        networkId: 'network:cctv',
      }, {
        id: 'topology-junction-switch',
        sourceNodeId: 'junction',
        targetNodeId: 'switch',
        relationType: 'point-on-line',
        relationSource: 'inferred_point_on_line',
        relationStatus: 'confirmed',
        networkId: 'network:cctv',
      }],
    },
  })

  const result = findTracePath(relationGraph, 'camera', 'switch')

  assert.deepEqual(result.assetIds, ['camera', 'junction', 'switch'])
  assert.deepEqual(
    result.relations.map(({ relationSource }) => relationSource),
    ['inferred_endpoint', 'inferred_point_on_line'],
  )
})

test('candidate, ambiguous, rejected, and revoked relations never enter tracing', () => {
  const topologyGraph = {
    edges: [
      {
        id: 'candidate-edge',
        sourceAssetId: 'A',
        targetAssetId: 'B',
        candidateStatus: 'candidate',
      },
      {
        id: 'revoked-edge',
        sourceAssetId: 'B',
        targetAssetId: 'C',
        verificationStatus: 'revoked',
      },
      {
        id: 'confirmed-edge',
        sourceAssetId: 'A',
        targetAssetId: 'C',
        verificationStatus: 'confirmed',
      },
    ],
  }
  const graph = buildExplicitRelationGraph({
    networks: [],
    assetIds: ['A', 'B', 'C'],
    topologyGraph,
  })

  assert.deepEqual(getConnectedAssets(graph, 'A').map(({ targetAssetId }) => targetAssetId), ['C'])
  assert.deepEqual(getConnectedAssets(graph, 'B'), [])
})

test('cycle-safe traversal finds a path without revisiting nodes forever', () => {
  const result = findTracePath(graph, 'a', 'd')

  assert.equal(result.status, 'found')
  assert.deepEqual(result.assetIds, ['a', 'c', 'd'])
  assert.equal(result.relations.length, 2)
})

test('breadth-first traversal chooses the deterministic shortest explicit path', () => {
  const multiPathGraph = buildExplicitRelationGraph({
    assetIds: ['a', 'b', 'c', 'd'],
    networks: [{
      id: 'network',
      edges: [['a', 'b'], ['b', 'd'], ['a', 'c'], ['c', 'd']],
    }],
  })

  assert.deepEqual(findTracePath(multiPathGraph, 'a', 'd').assetIds, ['a', 'b', 'd'])
})

test('unavailable and unreachable destinations return clear states', () => {
  assert.equal(findTracePath(graph, 'a', 'missing').status, 'invalid-target')
  assert.equal(findTracePath(graph, 'nearby', 'a').status, 'unreachable')
})

test('reachable destination discovery is cycle-safe and excludes the source', () => {
  const destinations = findReachableDestinations(graph, 'a')

  assert.deepEqual(destinations.map((item) => item.assetId), ['b', 'c', 'd'])
  assert.deepEqual(destinations.map((item) => item.distance), [1, 1, 2])
})
