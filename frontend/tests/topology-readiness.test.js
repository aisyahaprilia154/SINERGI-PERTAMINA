import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveTopologyReadiness,
  TOPOLOGY_GRAPH_INVALID_MESSAGE,
  TOPOLOGY_NO_DEVICE_EDGE_MESSAGE,
} from '../src/domain/topology-readiness.js'

test('readiness explains when generated topology has no device edge', () => {
  const result = resolveTopologyReadiness({
    topologyGraph: {
      nodes: [{ id: 'device-1' }],
      edges: [],
      graphRevision: 'topology-graph:1',
    },
    readinessContract: {
      topologyReady: false,
      topologyStatus: 'review_required',
      validation: { errorCount: 0 },
      blockers: [{ code: 'no_confirmed_device_edge' }],
      capabilities: { trace: false, diagram: false },
    },
  })

  assert.equal(result.traceAvailable, false)
  assert.equal(result.traceMessage, TOPOLOGY_NO_DEVICE_EDGE_MESSAGE)
})

test('readiness keeps invalid confirmed graph as the highest priority error', () => {
  const result = resolveTopologyReadiness({
    topologyGraph: { nodes: [], edges: [] },
    readinessContract: {
      topologyReady: false,
      topologyStatus: 'invalid',
      validation: { errorCount: 1 },
      blockers: [{ code: 'confirmed_graph_invalid' }],
      capabilities: { trace: false, diagram: false },
    },
  })

  assert.equal(result.traceMessage, TOPOLOGY_GRAPH_INVALID_MESSAGE)
})

test('mounting edit capability is independent from topology candidate review', () => {
  const result = resolveTopologyReadiness({
    topologyGraph: { nodes: [{ id: 'pole-1' }], edges: [] },
    readinessContract: {
      topologyReady: false,
      validation: { errorCount: 0 },
      capabilities: {
        reviewTopology: false,
        editAssetMounting: true,
        trace: false,
        diagram: false,
      },
    },
  })

  assert.equal(result.capabilities.reviewTopology, false)
  assert.equal(result.capabilities.editAssetMounting, true)
})
