import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExplicitRelationGraph,
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

test('candidate, ambiguous, rejected, and revoked relations never enter the relation graph', () => {
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
