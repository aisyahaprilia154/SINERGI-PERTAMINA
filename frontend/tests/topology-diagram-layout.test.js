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

test('compound pole layout keeps JB and CCTV in one readable physical block', () => {
  const poleAssets = [
    { id: 'compound-root', name: 'Core', type: 'Core Router', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'compound-jb', name: 'JB-08', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'compound-camera-a', name: 'CAM-22', type: 'CCTV Camera', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'compound-camera-b', name: 'CAM-23', type: 'CCTV Camera', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'compound-pole', name: 'T-08', type: 'Tiang CCTV', topologyRole: 'physical-mount', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets: poleAssets,
    graph: {
      graphRevision: 'compound-revision',
      nodes: poleAssets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'compound-root-jb', sourceNodeId: 'compound-root', targetNodeId: 'compound-jb', relationStatus: 'confirmed' },
        { id: 'compound-jb-camera-a', sourceNodeId: 'compound-jb', targetNodeId: 'compound-camera-a', relationStatus: 'confirmed' },
        { id: 'compound-jb-camera-b', sourceNodeId: 'compound-jb', targetNodeId: 'compound-camera-b', relationStatus: 'confirmed' },
      ],
    },
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
    mountingRelations: [
      { id: 'mount-compound-jb', relationType: 'mounted_on', sourceAssetId: 'compound-jb', targetAssetId: 'compound-pole' },
      { id: 'mount-compound-camera-a', relationType: 'mounted_on', sourceAssetId: 'compound-camera-a', targetAssetId: 'compound-pole' },
      { id: 'mount-compound-camera-b', relationType: 'mounted_on', sourceAssetId: 'compound-camera-b', targetAssetId: 'compound-pole' },
    ],
  })
  const layout = calculateTopologyDiagramLayout(model, {
    layoutStyle: 'compound-poles',
    componentColumns: 1,
  })
  const childNodes = layout.nodes.filter(({ compoundGroupId }) => compoundGroupId === 'pole-group:compound-pole')
  assert.equal(model.completeness.complete, true)
  assert.equal(layout.strategy, 'compound-pole-network')
  assert.equal(childNodes.length, 3)
  assert.equal(layout.nodes.length, model.nodes.length)
  assert.equal(layout.edges.length, model.edges.length)
  for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
    const left = layout.nodes[leftIndex].diagram
    for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
      const right = layout.nodes[rightIndex].diagram
      assert.equal(
        left.x < right.x + right.width
          && left.x + left.width > right.x
          && left.y < right.y + right.height
          && left.y + left.height > right.y,
        false,
        'compound nodes must not overlap',
      )
    }
  }
})

test('compound edge routing exits physical blocks before crossing the network', () => {
  const assets = [
    { id: 'route-root', name: 'Core', type: 'Core Router', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'route-jb-a', name: 'JB-A', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'route-cam-a', name: 'CAM-A', type: 'CCTV Camera', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'route-jb-b', name: 'JB-B', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'route-cam-b', name: 'CAM-B', type: 'CCTV Camera', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'route-pole-a', name: 'T-A', type: 'Tiang CCTV', topologyRole: 'physical-mount', locationGroupKey: 'area-a' },
    { id: 'route-pole-b', name: 'T-B', type: 'Tiang CCTV', topologyRole: 'physical-mount', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'compound-route-revision',
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'route-root-a', sourceNodeId: 'route-root', targetNodeId: 'route-jb-a', relationStatus: 'confirmed' },
        { id: 'route-a-camera', sourceNodeId: 'route-jb-a', targetNodeId: 'route-cam-a', relationStatus: 'confirmed' },
        { id: 'route-a-b', sourceNodeId: 'route-jb-a', targetNodeId: 'route-jb-b', relationStatus: 'confirmed' },
        { id: 'route-b-camera', sourceNodeId: 'route-jb-b', targetNodeId: 'route-cam-b', relationStatus: 'confirmed' },
      ],
    },
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
    mountingRelations: [
      { id: 'route-mount-jb-a', relationType: 'mounted_on', sourceAssetId: 'route-jb-a', targetAssetId: 'route-pole-a' },
      { id: 'route-mount-cam-a', relationType: 'mounted_on', sourceAssetId: 'route-cam-a', targetAssetId: 'route-pole-a' },
      { id: 'route-mount-jb-b', relationType: 'mounted_on', sourceAssetId: 'route-jb-b', targetAssetId: 'route-pole-b' },
      { id: 'route-mount-cam-b', relationType: 'mounted_on', sourceAssetId: 'route-cam-b', targetAssetId: 'route-pole-b' },
    ],
  })
  const layout = calculateTopologyDiagramLayout(model, {
    layoutStyle: 'compound-poles',
    componentColumns: 1,
  })
  const groupByNode = new Map(layout.mountingGroupBounds
    .flatMap((group) => group.childIds.map((id) => [id, group])))
  const crossGroupEdge = layout.edges.find(({ id }) => id === 'route-a-b')
  assert.ok(crossGroupEdge)
  assert.ok(crossGroupEdge.routePoints.length >= 2)
  for (let index = 1; index < crossGroupEdge.routePoints.length; index += 1) {
    const previous = crossGroupEdge.routePoints[index - 1]
    const current = crossGroupEdge.routePoints[index]
    assert.equal(previous.x === current.x || previous.y === current.y, true)
  }
  const sourceGroup = groupByNode.get('route-jb-a')
  const targetGroup = groupByNode.get('route-jb-b')
  assert.notEqual(sourceGroup.id, targetGroup.id)
  const crossesBoundary = (boundaryX) => crossGroupEdge.routePoints.some((point, index, points) => {
    if (!index) return false
    const previous = points[index - 1]
    return previous.y === point.y
      && Math.min(previous.x, point.x) <= boundaryX
      && Math.max(previous.x, point.x) >= boundaryX
  })
  assert.equal(crossesBoundary(sourceGroup.right), true)
  assert.equal(crossesBoundary(targetGroup.left), true)
  assert.equal(
    layout.edges.find(({ id }) => id === 'route-a-camera').routePoints.length,
    2,
    'internal JB-CCTV wiring stays inside the physical block',
  )
})
