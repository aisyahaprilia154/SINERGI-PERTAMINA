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
  assert.equal(layout.sections[0].lanes[0].presentation, 'pole-backbone')
  assert.equal(layout.mountingBoxes.length, 1)
  assert.equal(layout.mountingBoxes[0].kind, 'needs-mounting')
  assert.equal(layout.mountingBoxes[0].label, 'Perlu mounting')

  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('jb-01').semanticTier, 'junction-peer')
  assert.equal(byId.get('jb-02').semanticTier, 'junction-peer')
  assert.equal(byId.get('jb-03').semanticTier, 'junction-peer')
  assert.equal(byId.get('jb-01').mountingRole, 'entry-junction')
  assert.equal(byId.get('jb-02').mountingRole, 'downstream-junction')
  assert.equal(byId.get('endpoint').mountingRole, 'endpoint')
  assert.equal(byId.get('jb-01').mountingBoxId, 'needs-mounting:area-a')
  assert.equal(byId.get('jb-02').layoutParentId, 'jb-01')
  assert.equal(byId.get('jb-03').layoutParentId, 'jb-02')
  assert.ok(byId.get('jb-01').diagram.y < byId.get('jb-02').diagram.y)
  assert.ok(byId.get('jb-02').diagram.y < byId.get('jb-03').diagram.y)
  assert.ok(byId.get('root').diagram.y < byId.get('jb-01').diagram.y)
  assert.ok(byId.get('root').diagram.centerX >= byId.get('jb-01').diagram.x)
  assert.ok(byId.get('root').diagram.centerX <= byId.get('jb-01').diagram.x + byId.get('jb-01').diagram.width)
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
  const junctionEdge = layout.edges.find(({ id }) => id === 'jb-01-jb-02')
  assert.deepEqual(junctionEdge.routePoints[0], {
    x: byId.get('jb-01').diagram.centerX,
    y: byId.get('jb-01').diagram.centerY + 19,
  })
  assert.deepEqual(junctionEdge.routePoints.at(-1), {
    x: byId.get('jb-02').diagram.centerX,
    y: byId.get('jb-02').diagram.centerY - 19,
  })
  const endpointEdge = layout.edges.find(({ id }) => id === 'jb-ext-endpoint')
  assert.deepEqual(endpointEdge.routePoints.at(-1), {
    x: byId.get('endpoint').diagram.centerX,
    y: byId.get('endpoint').diagram.centerY - 12,
  })
  assert.ok(layout.bounds.minX <= 0)
  assert.ok(layout.bounds.minY <= 0)
  assert.ok(layout.bounds.maxX >= layout.width)
  assert.ok(layout.bounds.maxY >= layout.height)
})

test('pole backbone aligns one entry JB per mounting box and stacks descendants', () => {
  const assets = [
    { id: 'core', name: 'Core', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'pole-a', name: 'Tiang A', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-b', name: 'Tiang B', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-empty', name: 'Tiang Kosong', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'jb-a', name: 'JB-A', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'jb-a-ext', name: 'JB-EXT-A', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'cam-a', name: 'CAM-A', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'jb-b', name: 'JB-B', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'jb-b-02', name: 'JB-B-02', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'cam-b', name: 'CAM-B', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'jb-unknown', name: 'JB-UNKNOWN', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
  ]
  const edges = [
    ['core-a', 'core', 'jb-a'],
    ['a-b', 'jb-a', 'jb-b'],
    ['a-ext', 'jb-a', 'jb-a-ext'],
    ['ext-cam', 'jb-a-ext', 'cam-a'],
    ['b-child', 'jb-b', 'jb-b-02'],
    ['b-cam', 'jb-b-02', 'cam-b'],
    ['b-unknown', 'jb-b', 'jb-unknown'],
  ].map(([id, sourceNodeId, targetNodeId]) => ({
    id, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
  }))
  const mountingRelations = [
    ['mount-a', 'jb-a', 'pole-a'],
    ['mount-a-ext', 'jb-a-ext', 'pole-a'],
    ['mount-cam-a', 'cam-a', 'pole-a'],
    ['mount-b', 'jb-b', 'pole-b'],
    ['mount-b-02', 'jb-b-02', 'pole-b'],
    ['mount-cam-b', 'cam-b', 'pole-b'],
  ].map(([id, sourceAssetId, targetAssetId]) => ({
    id, relationType: 'mounted_on', sourceAssetId, targetAssetId,
  }))
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'pole-backbone',
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges,
    },
    roots: ['core'],
    mountingRelations,
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
  const layout = calculateTopologyDiagramLayout(model)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const boxes = new Map(layout.mountingBoxes.map((box) => [box.id, box]))

  assert.equal(boxes.size, 4)
  assert.equal(boxes.get('pole-group:pole-a').kind, 'confirmed')
  assert.equal(boxes.get('pole-group:pole-b').kind, 'confirmed')
  assert.equal(boxes.get('pole-group:pole-empty').kind, 'empty')
  assert.deepEqual(boxes.get('pole-group:pole-empty').nodeIds, [])
  assert.equal(boxes.get('needs-mounting:area-a').kind, 'needs-mounting')
  assert.equal(byId.get('jb-a').diagram.y, byId.get('jb-b').diagram.y)
  assert.equal(byId.get('jb-b').diagram.y, byId.get('jb-unknown').diagram.y)
  assert.ok(byId.get('jb-a-ext').diagram.y > byId.get('jb-a').diagram.y)
  assert.ok(byId.get('jb-b-02').diagram.y > byId.get('jb-b').diagram.y)
  assert.ok(byId.get('cam-a').diagram.y > byId.get('jb-a-ext').diagram.y)
  assert.ok(byId.get('cam-b').diagram.y > byId.get('jb-b-02').diagram.y)
  assert.equal(layout.edges.length, edges.length)

  for (const edgeId of ['core-a', 'a-b', 'b-unknown']) {
    const edge = layout.edges.find((candidate) => candidate.id === edgeId)
    const source = byId.get(edge.sourceId)
    const target = byId.get(edge.targetId)
    const relatedBoxes = [source.mountingBoxId, target.mountingBoxId]
      .map((id) => boxes.get(id))
      .filter(Boolean)
    assert.ok(edge.routePoints.length >= 3)
    assert.ok(edge.routePoints[1].y < Math.min(...relatedBoxes.map((box) => box.y)))
  }
  const coreEdge = layout.edges.find(({ id }) => id === 'core-a')
  assert.deepEqual(coreEdge.routePoints[0], {
    x: byId.get('core').diagram.centerX,
    y: byId.get('core').diagram.centerY + 26,
  })
  assert.deepEqual(coreEdge.routePoints.at(-1), {
    x: byId.get('jb-a').diagram.centerX,
    y: byId.get('jb-a').diagram.centerY - 19,
  })
  const crossBoxEdge = layout.edges.find(({ id }) => id === 'a-b')
  assert.deepEqual(crossBoxEdge.routePoints[0], {
    x: byId.get('jb-a').diagram.centerX,
    y: byId.get('jb-a').diagram.centerY - 19,
  })
  assert.deepEqual(crossBoxEdge.routePoints.at(-1), {
    x: byId.get('jb-b').diagram.centerX,
    y: byId.get('jb-b').diagram.centerY - 19,
  })

  for (const box of layout.mountingBoxes) {
    for (const nodeId of box.nodeIds) {
      const diagram = byId.get(nodeId).diagram
      assert.ok(diagram.x >= box.x && diagram.x + diagram.width <= box.x + box.width)
      assert.ok(diagram.y >= box.y && diagram.y + diagram.height <= box.y + box.height)
    }
  }
  for (let leftIndex = 0; leftIndex < layout.mountingBoxes.length; leftIndex += 1) {
    const left = layout.mountingBoxes[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < layout.mountingBoxes.length; rightIndex += 1) {
      const right = layout.mountingBoxes[rightIndex]
      const overlaps = left.x < right.x + right.width && left.x + left.width > right.x
        && left.y < right.y + right.height && left.y + left.height > right.y
      assert.equal(overlaps, false, 'mounting box overlap')
    }
  }
})

test('duplicate persisted component IDs do not drop topology lanes or pole groups', () => {
  const assets = [
    { id: 'core', name: 'Server', type: 'Server Rack', topologyRole: 'root', locationGroupKey: 'area-a' },
    { id: 'jb-a', name: 'JB-A', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'cam-a', name: 'Cam-A', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'jb-b', name: 'JB-B', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'cam-b', name: 'Cam-B', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'pole-a', name: 'T-01', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-b', name: 'T-02', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'duplicate-components',
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'edge-a', sourceNodeId: 'jb-a', targetNodeId: 'cam-a', relationStatus: 'confirmed' },
        { id: 'edge-b', sourceNodeId: 'jb-b', targetNodeId: 'cam-b', relationStatus: 'confirmed' },
      ],
      components: [
        { componentId: 'component:duplicate', nodeIds: ['jb-a', 'cam-a'] },
        { componentId: 'component:duplicate', nodeIds: ['jb-b', 'cam-b'] },
      ],
    },
    mountingRelations: [
      { id: 'mount-a', relationType: 'mounted_on', sourceAssetId: 'jb-a', targetAssetId: 'pole-a' },
      { id: 'mount-b', relationType: 'mounted_on', sourceAssetId: 'jb-b', targetAssetId: 'pole-b' },
    ],
    roots: ['core'],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
  const layout = calculateTopologyDiagramLayout(model)
  assert.equal(new Set(model.components.map(({ componentId }) => componentId)).size, 2)
  assert.ok(layout.mountingBoxes.some(({ id }) => id === 'pole-group:pole-a'))
  assert.ok(layout.mountingBoxes.some(({ id }) => id === 'pole-group:pole-b'))
  assert.equal(layout.nodes.filter(({ id }) => ['jb-a', 'cam-a', 'jb-b', 'cam-b'].includes(id)).length, 4)
})

test('endpoint cameras stay inside the connected JB or pole scope', () => {
  const assets = [
    { id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'pole-1', name: 'Tiang 01', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'jb-1', name: 'JB-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'cam-1', name: 'Cam-01', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'jb-2', name: 'JB-02', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'cam-2', name: 'Cam-02', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'cam-5', name: 'Cam-05', type: 'CCTV', topologyRole: 'endpoint', mountingExpectation: 'indoor', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'endpoint-jb-scope',
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'server-jb-1', sourceNodeId: 'server', targetNodeId: 'jb-1', relationStatus: 'confirmed' },
        { id: 'jb-1-cam-1', sourceNodeId: 'jb-1', targetNodeId: 'cam-1', relationStatus: 'confirmed' },
        { id: 'jb-2-cam-2', sourceNodeId: 'jb-2', targetNodeId: 'cam-2', relationStatus: 'confirmed' },
        { id: 'server-cam-5', sourceNodeId: 'server', targetNodeId: 'cam-5', relationStatus: 'confirmed' },
      ],
    },
    roots: ['server'],
    mountingRelations: [
      { id: 'mount-jb-1', relationType: 'mounted_on', sourceAssetId: 'jb-1', targetAssetId: 'pole-1' },
    ],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
  const layout = calculateTopologyDiagramLayout(model)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const boxes = new Map(layout.mountingBoxes.map((box) => [box.id, box]))

  const poleBox = boxes.get('pole-group:pole-1')
  assert.deepEqual(new Set(poleBox.nodeIds), new Set(['jb-1', 'cam-1']))
  assert.equal(byId.get('cam-1').mountingBoxId, poleBox.id)
  assert.equal(byId.get('cam-1').mountingRelationStatus, 'needs-mounting')

  const jbBox = [...boxes.values()].find((box) => box.label === 'JB-02')
  assert.ok(jbBox)
  assert.deepEqual(new Set(jbBox.nodeIds), new Set(['jb-2', 'cam-2']))
  assert.equal(byId.get('cam-2').mountingBoxId, jbBox.id)
  assert.equal(byId.get('cam-2').mountingRelationStatus, 'unassigned')

  const indoorBox = [...boxes.values()].find((box) => box.kind === 'excluded')
  assert.ok(indoorBox)
  assert.equal(indoorBox.label, 'Area non-tiang/indoor')
  assert.deepEqual(indoorBox.nodeIds, ['cam-5'])
  assert.equal(byId.get('cam-5').layoutParentId, 'server')
  assert.ok(layout.nodes
    .filter(({ id }) => id !== 'server')
    .every((node) => byId.get('server').diagram.y < node.diagram.y))
})

test('numbered JB extensions stay below their matching base JB', () => {
  const assets = [
    { id: 'core', name: 'Rack', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'pole-11', name: 'T-011', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-15', name: 'T-015', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-17', name: 'T-017', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-18', name: 'T-018', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-20', name: 'T-020', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'base-11', name: 'JB-011-exp', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'base-15', name: 'JB-015', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'base-17', name: 'JB-017', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'base-18', name: 'JB-018', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'base-19', name: 'JB-019', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'child-11', name: 'JB-011.1-exp', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'child-15', name: 'JB-15.1-WP', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'child-17', name: 'JB-17.1-WP', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'child-18', name: 'JB-18.1-WP', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'child-19-1', name: 'JB-19.1-WP', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    { id: 'child-19-2', name: 'JB-19.2-WP', type: 'JB Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
  ]
  const relations = [
    ['core-11', 'core', 'base-11'],
    ['core-15', 'core', 'base-15'],
    ['core-17', 'core', 'base-17'],
    ['core-18', 'core', 'base-18'],
    ['core-19', 'core', 'base-19'],
    ['base-11-child', 'base-11', 'child-11'],
    ['base-15-child', 'base-15', 'child-15'],
    ['base-17-child', 'base-17', 'child-17'],
    ['base-18-child', 'base-18', 'child-18'],
    ['base-19-child', 'base-19', 'child-19-1'],
    // The source graph may connect this extension through another confirmed
    // route. Its number still supplies the presentation parent only.
    ['core-19-2', 'core', 'child-19-2'],
  ].map(([id, sourceNodeId, targetNodeId]) => ({
    id, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
  }))
  const mountingRelations = [
    ['mount-11', 'base-11', 'pole-11'],
    ['mount-15', 'base-15', 'pole-15'],
    ['mount-17-child', 'child-17', 'pole-17'],
    ['mount-18-child', 'child-18', 'pole-18'],
    ['mount-19-child', 'child-19-1', 'pole-20'],
  ].map(([id, sourceAssetId, targetAssetId]) => ({
    id, relationType: 'mounted_on', sourceAssetId, targetAssetId,
  }))
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'numbered-jb-parenting',
      nodes: assets
        .filter(({ topologyRole }) => topologyRole !== 'physical_mount')
        .map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: relations,
    },
    roots: ['core'],
    mountingRelations,
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
  const layout = calculateTopologyDiagramLayout(model)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))

  for (const baseId of ['base-11', 'base-15', 'base-17', 'base-18', 'base-19']) {
    assert.equal(byId.get(baseId).rowIndex, 0)
    assert.equal(byId.get(baseId).layoutParentId, 'core')
  }
  for (const [childId, parentId] of [
    ['child-11', 'base-11'],
    ['child-15', 'base-15'],
    ['child-17', 'base-17'],
    ['child-18', 'base-18'],
    ['child-19-1', 'base-19'],
    ['child-19-2', 'base-19'],
  ]) {
    assert.equal(byId.get(childId).rowIndex, 1)
    assert.equal(byId.get(childId).layoutParentId, parentId)
    assert.ok(byId.get(childId).diagram.y > byId.get(parentId).diagram.y)
    assert.equal(byId.get(childId).mountingBoxId, byId.get(parentId).mountingBoxId)
  }
  assert.equal(byId.get('base-11').mountingRelationStatus, 'confirmed')
  assert.equal(byId.get('child-11').mountingRelationStatus, 'needs-mounting')
  assert.equal(byId.get('base-17').mountingRelationStatus, 'needs-mounting')
  assert.equal(byId.get('child-17').mountingRelationStatus, 'confirmed')
  assert.equal(byId.get('base-19').mountingRelationStatus, 'needs-mounting')
  assert.equal(byId.get('child-19-1').mountingRelationStatus, 'confirmed')
  assert.equal(byId.get('child-19-2').mountingRelationStatus, 'needs-mounting')
  assert.ok(byId.get('base-11').diagram.x < byId.get('base-15').diagram.x)
  assert.ok(byId.get('base-15').diagram.x < byId.get('base-17').diagram.x)
  assert.ok(byId.get('base-17').diagram.x < byId.get('base-18').diagram.x)
  assert.ok(byId.get('base-18').diagram.x < byId.get('base-19').diagram.x)
  assert.ok(byId.get('child-11').diagram.x < byId.get('child-15').diagram.x)
  assert.ok(byId.get('child-15').diagram.x < byId.get('child-17').diagram.x)
  assert.ok(byId.get('child-17').diagram.x < byId.get('child-18').diagram.x)
  assert.ok(byId.get('child-18').diagram.x < byId.get('child-19-1').diagram.x)
})

test('confirmed extension poles form child boxes below their numbered parent poles', () => {
  const assets = [
    { id: 'core', name: 'Rack', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'pole-1', name: 'T-001', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-11', name: 'T-011', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-19', name: 'T-019', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'pole-21', name: 'T-021', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'base-1', name: 'JB-001-exp', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'base-11', name: 'JB-011-exp', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'child-1', name: 'JB-01.1-WP', type: 'Extended', topologyRole: 'junction_extended', locationGroupKey: 'area-a' },
    // Mirrors FT Pengapon source metadata: the name marks an extension even
    // though the source type/profile presents it as a regular junction.
    { id: 'child-11', name: 'JB-011.1-exp', type: 'JB Rekomendasi', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'cam-1', name: 'C-019', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'cam-11', name: 'C-037', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
  ]
  const edges = [
    ['core-1', 'core', 'base-1'],
    ['core-11', 'core', 'base-11'],
    ['base-child-1', 'base-1', 'child-1'],
    ['base-child-11', 'base-11', 'child-11'],
    ['child-cam-1', 'child-1', 'cam-1'],
    ['child-cam-11', 'child-11', 'cam-11'],
  ].map(([id, sourceNodeId, targetNodeId]) => ({
    id, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
  }))
  const mountingRelations = [
    ['mount-base-1', 'base-1', 'pole-1'],
    ['mount-base-11', 'base-11', 'pole-11'],
    ['mount-child-1', 'child-1', 'pole-19'],
    ['mount-cam-1', 'cam-1', 'pole-19'],
    ['mount-child-11', 'child-11', 'pole-21'],
    ['mount-cam-11', 'cam-11', 'pole-21'],
  ].map(([id, sourceAssetId, targetAssetId]) => ({
    id, relationType: 'mounted_on', sourceAssetId, targetAssetId,
  }))
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'cross-pole-numbered-extensions',
      nodes: assets
        .filter(({ topologyRole }) => topologyRole !== 'physical_mount')
        .map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges,
    },
    roots: ['core'],
    mountingRelations,
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
  const layout = calculateTopologyDiagramLayout(model)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const boxes = new Map(layout.mountingBoxes.map((box) => [box.id, box]))

  for (const [baseId, childId, parentBoxId, childBoxId, edgeId] of [
    ['base-1', 'child-1', 'pole-group:pole-1', 'pole-group:pole-19', 'base-child-1'],
    ['base-11', 'child-11', 'pole-group:pole-11', 'pole-group:pole-21', 'base-child-11'],
  ]) {
    const parentBox = boxes.get(parentBoxId)
    const childBox = boxes.get(childBoxId)
    assert.equal(childBox.layoutParentBoxId, parentBox.id)
    assert.ok(childBox.y >= parentBox.y + parentBox.height)
    assert.equal(childBox.x + childBox.width / 2, parentBox.x + parentBox.width / 2)
    assert.equal(byId.get(childId).layoutParentId, baseId)
    assert.equal(byId.get(childId).mountingRole, 'downstream-junction')
    assert.ok(byId.get(childId).diagram.y > byId.get(baseId).diagram.y)
    const route = layout.edges.find(({ id }) => id === edgeId).routePoints
    assert.deepEqual(route[0], {
      x: byId.get(baseId).diagram.centerX,
      y: byId.get(baseId).diagram.bottomY,
    })
    assert.deepEqual(route.at(-1), {
      x: byId.get(childId).diagram.centerX,
      y: byId.get(childId).diagram.topY,
    })
  }
  assert.equal(boxes.get('pole-group:pole-1').y, boxes.get('pole-group:pole-11').y)
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
