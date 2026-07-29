import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTopologyViewModel,
  prioritizeTopologyCandidates,
  sanitizeConfirmedGraph,
} from '../src/domain/topology-view-model.js'

const assets = [{
  id: 'SW-CORE',
  name: 'Core Switch',
  type: 'Core switch',
  category: 'Infrastructure',
}, {
  id: 'CAM-01',
  name: 'Gate Camera',
  type: 'CCTV',
  category: 'CCTV',
}, {
  id: 'CAM-02',
  name: 'Yard Camera',
  type: 'CCTV',
  category: 'CCTV',
}]

const graph = {
  datasetVersionId: 'dv-1',
  nodes: assets.map(({ id }) => ({ id, assetId: id })),
  edges: [{
    id: 'confirmed-edge',
    sourceAssetId: 'SW-CORE',
    targetAssetId: 'CAM-01',
    verificationStatus: 'confirmed',
  }, {
    id: 'candidate-leak',
    sourceAssetId: 'SW-CORE',
    targetAssetId: 'CAM-02',
    verificationStatus: 'candidate',
  }],
  components: [{ id: 'component-1', nodeIds: ['SW-CORE', 'CAM-01'] }],
  isolatedNodeIds: ['CAM-02'],
}

test('topology projection rejects non-confirmed edges before rendering', () => {
  const sanitized = sanitizeConfirmedGraph(graph)
  assert.deepEqual(sanitized.edges.map(({ id }) => id), ['confirmed-edge'])
})

test('presentation filters dim nodes without changing canonical graph counts', () => {
  const view = buildTopologyViewModel({
    assets,
    graph,
    state: {
      selectedAssetId: 'CAM-01',
      selectedCategories: new Set(['cctv']),
      focusOnly: true,
      search: '',
    },
  })

  assert.equal(view.graphNodeCount, 3)
  assert.equal(view.graphEdgeCount, 1)
  assert.equal(view.nodes.length, 3)
  assert.equal(view.nodes.find(({ id }) => id === 'SW-CORE').neighbor, true)
  assert.equal(view.nodes.find(({ id }) => id === 'CAM-02').dimmed, true)
})

test('candidate queue prioritizes ambiguous component-impact candidates', () => {
  const ordered = prioritizeTopologyCandidates([{
    candidateId: 'high-score',
    candidateStatus: 'candidate',
    targetAssetId: 'CAM-02',
    score: 0.99,
  }, {
    candidateId: 'ambiguous-impact',
    candidateStatus: 'ambiguous',
    targetAssetId: 'CAM-01',
    score: 0.65,
  }], graph)

  assert.equal(ordered[0].candidateId, 'ambiguous-impact')
})
