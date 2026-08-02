import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateRelationReadiness,
  isUserConfirmedRelation,
} from '../src/domain/relation-readiness.js'

function nodes(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index + 1}`,
    layerId: 'layer-cctv',
  }))
}

function edge(status = 'explicit_confirmed') {
  return {
    id: `edge:${status}`,
    sourceNodeId: 'asset-1',
    targetNodeId: 'asset-2',
    relationSource: status === 'explicit_confirmed' ? 'explicit' : 'inferred_endpoint',
    relationStatus: status,
    networkId: 'network:cctv',
  }
}

test('layer with 22 nodes and zero confirmed edges is not trace or diagram ready', () => {
  const readiness = evaluateRelationReadiness({
    topologyGraph: {
      nodes: nodes(22),
      edges: [],
      candidateEdges: [],
      unresolvedEndpoints: [],
    },
    nodeIds: nodes(22).map(({ id }) => id),
  })

  assert.equal(readiness.nodeCount, 22)
  assert.equal(readiness.confirmedEdgeCount, 0)
  assert.equal(readiness.isolatedNodeCount, 22)
  assert.equal(readiness.canTrace, false)
  assert.equal(readiness.canCreateDiagram, false)
})

test('isolated asset cannot trace while one confirmed adjacency can', () => {
  const topologyGraph = {
    nodes: nodes(3),
    edges: [edge()],
    candidateEdges: [],
    unresolvedEndpoints: [],
  }

  assert.equal(evaluateRelationReadiness({
    topologyGraph,
    assetId: 'asset-3',
  }).canTrace, false)
  const connected = evaluateRelationReadiness({
    topologyGraph,
    assetId: 'asset-1',
  })
  assert.equal(connected.canTrace, true)
  assert.equal(connected.canCreateDiagram, true)
})

test('inferred pending is diagnostic-only, while Admin confirmed is User-ready', () => {
  const pending = edge('inferred_pending')
  const pendingReadiness = evaluateRelationReadiness({
    topologyGraph: {
      nodes: nodes(2),
      edges: [],
      candidateEdges: [pending],
    },
    assetId: 'asset-1',
  })

  assert.equal(isUserConfirmedRelation(pending), false)
  assert.equal(pendingReadiness.inferredEdgeCount, 1)
  assert.equal(pendingReadiness.pendingEdgeCount, 1)
  assert.equal(pendingReadiness.canTrace, false)
  assert.equal(pendingReadiness.canCreateDiagram, false)

  const confirmed = edge('admin_confirmed')
  const confirmedReadiness = evaluateRelationReadiness({
    topologyGraph: {
      nodes: nodes(2),
      edges: [confirmed],
      candidateEdges: [],
    },
    assetId: 'asset-1',
  })
  assert.equal(isUserConfirmedRelation(confirmed), true)
  assert.equal(confirmedReadiness.canTrace, true)
  assert.equal(confirmedReadiness.canCreateDiagram, true)
})

test('readiness distinguishes geographic lines, pending edges, and unresolved endpoints', () => {
  const readiness = evaluateRelationReadiness({
    topologyGraph: {
      nodes: nodes(2),
      edges: [],
      candidateEdges: [edge('inferred_pending')],
      geographicLines: [{
        id: 'line-1',
        networkId: 'network:cctv',
        layerId: 'layer-cctv',
      }],
      attachments: [{
        nodeId: 'asset-1',
        pathGeometryId: 'line-1',
      }],
      unresolvedEndpoints: [{
        sourceNodeId: 'asset-1',
        networkId: 'network:cctv',
      }],
    },
    networkIds: ['network:cctv'],
  })

  assert.equal(readiness.geographicLineCount, 1)
  assert.equal(readiness.pendingEdgeCount, 1)
  assert.equal(readiness.unresolvedEndpointCount, 1)
  assert.equal(readiness.confirmedEdgeCount, 0)
})
