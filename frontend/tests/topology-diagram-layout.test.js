import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramModel } from '../src/domain/topology-diagram-model.js'
import {
  calculateTopologyDiagramLayout,
  createTopologyDiagramLayoutCacheKey,
} from '../src/pages/topology/topology-diagram-layout.js'

function fixture() {
  const assets = [
    { id: 'root', name: 'Core', type: 'Core Router', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'jb-01', name: 'JB-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'jb-02', name: 'JB-02', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'jb-03', name: 'JB-03', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'jb-ext', name: 'JB Extended 01', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'endpoint', name: 'Endpoint', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'isolated', name: 'No relation', type: 'Printer', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
  ]
  const graph = {
    graphRevision: 'layout-revision',
    nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
    edges: [
      { id: 'root-jb-01', sourceNodeId: 'root', targetNodeId: 'jb-01', relationStatus: 'confirmed' },
      { id: 'jb-01-jb-02', sourceNodeId: 'jb-01', targetNodeId: 'jb-02', relationStatus: 'confirmed' },
      { id: 'jb-02-jb-03', sourceNodeId: 'jb-02', targetNodeId: 'jb-03', relationStatus: 'confirmed' },
      { id: 'jb-02-jb-ext', sourceNodeId: 'jb-02', targetNodeId: 'jb-ext', relationStatus: 'confirmed' },
      { id: 'jb-ext-endpoint', sourceNodeId: 'jb-ext', targetNodeId: 'endpoint', relationStatus: 'confirmed' },
    ],
  }
  return buildTopologyDiagramModel({
    assets,
    graph,
    roots: ['root'],
    showAdminLayers: true,
    candidates: [{
      candidateId: 'candidate-junction-isolated',
      candidateStatus: 'candidate',
      sourcePathAssetId: 'jb-02',
      targetAssetId: 'isolated',
    }],
    unresolved: [{
      unresolvedId: 'unresolved-endpoint',
      sourcePathAssetId: 'endpoint',
      reason: 'endpoint_without_safe_target',
    }],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
}

test('layout is top-down, orthogonal, bounded, and does not overlap nodes', () => {
  const model = fixture()
  const layout = calculateTopologyDiagramLayout(model)
  assert.equal(layout.status, 'ready')
  assert.equal(layout.strategy, 'central-backbone-network')
  assert.ok(layout.width > 0)
  assert.ok(layout.height > 0)
  assert.equal(layout.sections.length, 1)
  assert.equal(layout.unresolvedMarkers.length, 1)
  assert.equal(layout.sections[0].lanes[0].presentation, 'hub-spoke')

  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('jb-01').semanticTier, 'junction-peer')
  assert.equal(byId.get('jb-02').semanticTier, 'junction-peer')
  assert.equal(byId.get('jb-03').semanticTier, 'junction-peer')
  assert.equal(byId.get('jb-01').diagram.y, byId.get('jb-02').diagram.y)
  assert.equal(byId.get('jb-02').diagram.y, byId.get('jb-03').diagram.y)
  assert.ok(byId.get('root').diagram.y < byId.get('jb-01').diagram.y)
  assert.ok(byId.get('root').diagram.centerX > byId.get('jb-01').diagram.x)
  assert.ok(byId.get('root').diagram.centerX < byId.get('jb-03').diagram.x + byId.get('jb-03').diagram.width)
  assert.ok(byId.get('jb-ext').diagram.y > byId.get('jb-02').diagram.y)
  assert.ok(byId.get('endpoint').diagram.y > byId.get('jb-ext').diagram.y)

  for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
    const left = layout.nodes[leftIndex].diagram
    for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
      const right = layout.nodes[rightIndex].diagram
      const overlaps = left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y
      assert.equal(overlaps, false, 'node overlap')
    }
  }

  for (const edge of layout.edges) {
    assert.ok(edge.routePoints.length >= 2)
    assert.ok(edge.routePoints.length <= 4, 'edge routes through whitespace between hierarchy rows')
    for (let index = 1; index < edge.routePoints.length; index += 1) {
      const previous = edge.routePoints[index - 1]
      const current = edge.routePoints[index]
      assert.equal(previous.x === current.x || previous.y === current.y, true)
    }
  }
  assert.ok(layout.bounds.minX <= 0)
  assert.ok(layout.bounds.minY <= 0)
  assert.ok(layout.bounds.maxX >= layout.width)
  assert.ok(layout.bounds.maxY >= layout.height)
})

test('overview layout summarizes areas without materializing asset nodes', () => {
  const model = fixture()
  const overview = calculateTopologyDiagramLayout(model, { overview: true })
  assert.equal(overview.mode, 'area-overview')
  assert.equal(overview.nodes.length, 0)
  assert.equal(overview.edges.length, 0)
  assert.deepEqual(overview.overviewAreas.map(({ key }) => key), ['area-a'])
  assert.equal(overview.overviewAreas[0].nodeCount, model.nodes.length)
  assert.ok(overview.height < calculateTopologyDiagramLayout(model).height)
})

test('layout cache key changes with graph identity and presentation scope', () => {
  const model = fixture()
  const first = createTopologyDiagramLayoutCacheKey({
    model,
    selectedFamilies: new Set(['cctv']),
    hideFiltered: false,
  })
  const second = createTopologyDiagramLayoutCacheKey({
    model: { ...model, graphRevision: 'new-revision' },
    selectedFamilies: new Set(['cctv']),
    hideFiltered: false,
  })
  const third = createTopologyDiagramLayoutCacheKey({
    model,
    selectedFamilies: new Set(['infrastructure']),
    hideFiltered: true,
  })
  assert.notEqual(first, second)
  assert.notEqual(first, third)
})
