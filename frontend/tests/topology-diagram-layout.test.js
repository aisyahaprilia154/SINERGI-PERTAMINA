import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramModel } from '../src/domain/topology-diagram-model.js'
import {
  calculateTopologyDiagramLayout,
  createTopologyDiagramLayoutCacheKey,
} from '../src/pages/topology/topology-diagram-layout.js'

function assertEdgesAvoidOtherFrames(layout) {
  for (const edge of layout.edges) {
    for (const box of layout.mountingBoxes.filter(box =>
      !box.nodeIds.includes(edge.sourceId) && !box.nodeIds.includes(edge.targetId))) {
      for (let index = 1; index < edge.routePoints.length; index++) {
        const from = edge.routePoints[index - 1], to = edge.routePoints[index]
        const crossesVertical = from.x === to.x && from.x > box.x + 1
          && from.x < box.x + box.width - 1
          && Math.max(from.y, to.y) > box.y + 1
          && Math.min(from.y, to.y) < box.y + box.height - 1
        const crossesHorizontal = from.y === to.y && from.y > box.y + 1
          && from.y < box.y + box.height - 1
          && Math.max(from.x, to.x) > box.x + 1
          && Math.min(from.x, to.x) < box.x + box.width - 1
        assert.equal(crossesVertical || crossesHorizontal, false,
          `edge ${edge.id} must avoid ${box.label}`)
      }
    }
  }
}

function assertEdgesAvoidOtherNodes(layout) {
  for (const edge of layout.edges) {
    for (const node of layout.nodes.filter(node =>
      node.id !== edge.sourceId && node.id !== edge.targetId)) {
      const box = node.diagram
      for (let index = 1; index < edge.routePoints.length; index++) {
        const from = edge.routePoints[index - 1], to = edge.routePoints[index]
        const vertical = from.x === to.x && from.x > box.x + 1
          && from.x < box.x + box.width - 1
          && Math.max(from.y, to.y) > box.y + 1
          && Math.min(from.y, to.y) < box.y + box.height - 1
        const horizontal = from.y === to.y && from.y > box.y + 1
          && from.y < box.y + box.height - 1
          && Math.max(from.x, to.x) > box.x + 1
          && Math.min(from.x, to.x) < box.x + box.width - 1
        assert.equal(vertical || horizontal, false,
          `edge ${edge.id} must avoid node ${node.name}`)
      }
    }
  }
}

test('camera frames stay in their JB subtree across facilities and pole layouts', () => {
  for (const expectation of ['indoor', 'standalone']) {
  for (const area of ['ft-tegal-baru', 'dppu-yia', 'ft-pengapon-semarang', 'another-facility']) {
    const assets = [
      ['server', 'Server', 'Server Rack', 'core'],
      ['jb1', 'JB-01', 'Junction Box', 'junction'],
      ['jb2', 'JB-02', 'Junction Box', 'junction'],
      ['ext', 'JB-02.2', 'Extended', 'junction_extended'],
      ['p1', 'T-001', 'Pole', 'physical_mount'],
      ['p2', 'T-002', 'Pole', 'physical_mount'],
      ['pe', 'T-003', 'Pole', 'physical_mount'],
      ['c8', 'C-08', 'CCTV', 'endpoint'],
      ['c9', 'C-09', 'CCTV', 'endpoint'],
      ['ce', 'Extended camera', 'CCTV', 'endpoint'],
    ].map(([id, name, type, topologyRole]) => ({id, name, type, topologyRole,
      locationGroupKey: area,
      ...(topologyRole === 'endpoint' ? {mountingExpectation: expectation} : {}),
    }))
    const edges = [['server', 'jb1'], ['server', 'jb2'], ['jb2', 'ext'],
      ['jb1', 'c8'], ['jb1', 'c9'], ['ext', 'ce']].map(([sourceNodeId, targetNodeId]) => ({
      id: `${sourceNodeId}-${targetNodeId}`, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
    }))
    const model = buildTopologyDiagramModel({assets, roots: ['server'],
      graph: {nodes: assets, edges}, locationGroups: [{key: area, name: area}],
      mountingRelations: [['jb1', 'p1'], ['jb2', 'p2'], ['ext', 'pe']]
        .map(([sourceAssetId, targetAssetId]) => ({sourceAssetId, targetAssetId, relationType: 'mounted_on'})),
    })
    for (const layoutStyle of ['central-backbone', 'compound-poles', 'facility-schematic']) {
      const layout = calculateTopologyDiagramLayout(model, {layoutStyle})
      const frame = id => layout.mountingBoxes.find(box => box.nodeIds.includes(id))
      assert.equal(frame('c8').id, frame('c9').id, 'indoor siblings share their own frame')
      assert.equal(layout.nodes.find(node => node.id === 'c8').suppressTypeLabel, true)
      for (const [child, parent] of [['c8', 'jb1'], ['c9', 'jb1'], ['ce', 'ext']]) {
        const childFrame = frame(child), parentFrame = frame(parent)
        assert.notEqual(childFrame.id, parentFrame.id, 'network grouping does not imply pole mounting')
        assert.equal(childFrame.layoutParentBoxId, parentFrame.id)
        assert.equal(childFrame.layoutParentNodeId, parent)
        assert.ok(childFrame.y >= parentFrame.y + parentFrame.height)
        assert.ok(childFrame.x >= parentFrame.treeX)
        assert.ok(childFrame.x + childFrame.width <= parentFrame.treeX + parentFrame.treeWidth)
      }
      assert.ok(frame('c8').x + frame('c8').width <= frame('jb2').treeX,
        'the JB-01 family is kept together before the next JB family')
      assert.equal(layout.nodes.length, 7, 'every network asset is rendered exactly once')
      assert.equal(layout.edges.length, edges.length, 'grouping does not invent network connections')
    }
  }
  }
})

test('indoor cameras linked to both JB-02 and its extensions stay below their specific JB', () => {
  const area = 'ft-tegal-baru'
  const assets = [
    ['server', 'Server', 'Server Rack', 'core'],
    ['jb2', 'JB-02', 'Junction Box', 'junction'],
    ['jb22', 'JB-02.2', 'Junction Box', 'junction_extended'],
    ['jb23', 'JB-02.3', 'Junction Box', 'junction_extended'],
    ['jb24', 'JB-02.4', 'Junction Box', 'junction_extended'],
    ['pole', 'T-04', 'Pole', 'physical_mount'],
    ['c-base', 'C-08', 'CCTV', 'endpoint'],
    ['c14', 'C-14', 'CCTV', 'endpoint'],
    ['c-other', 'C-11', 'CCTV', 'endpoint'],
    ['c09', 'C-09', 'CCTV', 'endpoint'],
  ].map(([id, name, type, topologyRole]) => ({ id, name, type, topologyRole,
    locationGroupKey: area,
    ...(topologyRole === 'endpoint' ? { mountingExpectation: 'indoor' } : {}),
  }))
  const connections = [['server', 'jb2'], ['jb2', 'jb22'], ['jb2', 'jb23'], ['jb2', 'jb24'],
    ['jb2', 'c-base'], ['jb2', 'c14'], ['jb22', 'c14'],
    ['jb23', 'c-other'], ['jb2', 'c09'], ['jb24', 'c09']]
  const edges = connections.map(([sourceNodeId, targetNodeId]) => ({
    id: `${sourceNodeId}-${targetNodeId}`, sourceNodeId, targetNodeId,
    relationStatus: 'confirmed',
  }))
  const model = buildTopologyDiagramModel({ assets, roots: ['server'],
    graph: { nodes: assets, edges }, locationGroups: [{ key: area, name: area }],
    mountingRelations: ['jb2', 'jb22', 'jb23', 'jb24'].map(sourceAssetId => ({
      sourceAssetId, targetAssetId: 'pole', relationType: 'mounted_on',
    })) })

  for (const layoutStyle of ['central-backbone', 'compound-poles', 'facility-schematic']) {
    const layout = calculateTopologyDiagramLayout(model, { layoutStyle })
    const frame = id => layout.mountingBoxes.find(box => box.nodeIds.includes(id))
    for (const [cameraId, junctionId] of [['c14', 'jb22'], ['c09', 'jb24']]) {
      const camera = frame(cameraId), junction = frame(junctionId)
      assert.ok(camera && junction)
      assert.equal(camera.layoutParentBoxId, junction.id)
      assert.equal(camera.layoutParentNodeId, junctionId)
      assert.ok(camera.y >= junction.y + junction.height)
      assert.ok(camera.x >= junction.treeX)
      assert.ok(camera.x + camera.width <= junction.treeX + junction.treeWidth)
      assert.equal(layout.nodes.filter(node => node.id === cameraId).length, 1)
      const cameraCenter = layout.nodes.find(node => node.id === cameraId).diagram.centerX
      const junctionCenter = layout.nodes.find(node => node.id === junctionId).diagram.centerX
      if (layoutStyle !== 'facility-schematic') {
        assert.ok(Math.abs(cameraCenter - junctionCenter) <= camera.width / 2,
          `${layoutStyle}: ${cameraId} stays beneath the ${junctionId} branch`)
      }
    }
    const rowCounts = new Map()
    for (const id of ['c-base', 'c14', 'c-other', 'c09']) {
      const y = frame(id).y
      rowCounts.set(y, (rowCounts.get(y) ?? 0) + 1)
    }
    assert.deepEqual([...rowCounts.values()].sort(), [2, 2],
      'four indoor frames form a compact two-by-two grid')
    assert.equal(layout.edges.length, edges.length)
    if (layoutStyle === 'central-backbone') assertEdgesAvoidOtherFrames(layout)
    for (let left = 0; left < layout.mountingBoxes.length; left++) {
      for (let right = left + 1; right < layout.mountingBoxes.length; right++) {
        const a = layout.mountingBoxes[left], b = layout.mountingBoxes[right]
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x
          || a.y + a.height <= b.y || b.y + b.height <= a.y,
        'sibling frames do not overlap other frames')
      }
    }
  }
})

test('branch root frames keep one tier and equal gaps despite a wider child subtree', () => {
  const area = 'branch-area'
  const assets = [
    { id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: area },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `jb-${index}`, name: `JB-${index + 1}`,
      type: 'Junction Box', topologyRole: 'junction', locationGroupKey: area })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `pole-${index}`, name: `T-${index + 1}`,
      type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area })),
    { id: 'indoor', name: 'Indoor camera', type: 'CCTV', topologyRole: 'endpoint',
      mountingExpectation: 'indoor', locationGroupKey: area },
    { id: 'standalone', name: 'Standalone camera', type: 'CCTV', topologyRole: 'endpoint',
      mountingExpectation: 'standalone', locationGroupKey: area },
  ]
  const edges = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `server-jb-${index}`,
      sourceNodeId: 'server', targetNodeId: `jb-${index}`, relationStatus: 'confirmed' })),
    ...['indoor', 'standalone'].map(id => ({ id: `jb-0-${id}`,
      sourceNodeId: 'jb-0', targetNodeId: id, relationStatus: 'confirmed' })),
  ]
  const mountingRelations = Array.from({ length: 6 }, (_, index) => ({
    sourceAssetId: `jb-${index}`, targetAssetId: `pole-${index}`, relationType: 'mounted_on',
  }))
  const model = buildTopologyDiagramModel({ assets, graph: { nodes: assets, edges },
    mountingRelations, locationGroups: [{ key: area, name: area }] })
  const baseline = calculateTopologyDiagramLayout(model)
  const layout = calculateTopologyDiagramLayout(model, { mountingRootFrameGap: 64 })
  const roots = layout.mountingBoxes.filter(box => !box.layoutParentBoxId)
    .sort((left, right) => left.x - right.x)
  assert.ok(layout.width < baseline.width)
  assert.equal(new Set(roots.map(box => box.y)).size, 1)
  assert.deepEqual(roots.slice(1).map((box, index) => (
    box.x - roots[index].x - roots[index].width
  )), Array(5).fill(64))
  assert.equal(layout.nodes.length, 9)
  assert.equal(layout.edges.length, edges.length)
  assertEdgesAvoidOtherFrames(layout)
})

test('diagram frame assignment can move an asset into an Indoor frame without changing mounting evidence', () => {
  const area = 'area-a'
  const assets = [
    { id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: area },
    { id: 'pole', name: 'T-01', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area },
    { id: 'camera', name: 'CAM-01', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: area,
      mountingExpectation: 'pole' },
    { id: 'indoor', name: 'DC-01', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: area,
      mountingExpectation: 'indoor' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: { nodes: assets, edges: [] },
    mountingRelations: [{ sourceAssetId: 'camera', targetAssetId: 'pole', relationType: 'mounted_on' }],
    locationGroups: [{ key: area, name: area }],
  })
  const baseline = calculateTopologyDiagramLayout(model)
  const indoorFrame = baseline.mountingBoxes.find(box => box.kind === 'excluded')
  const poleFrame = baseline.mountingBoxes.find(box => box.hostId === 'pole')
  assert.ok(indoorFrame)
  assert.ok(poleFrame)

  const moved = calculateTopologyDiagramLayout(model, {
    frameAssignments: { camera: indoorFrame.id },
  })
  const movedIndoorFrame = moved.mountingBoxes.find(({ id }) => id === indoorFrame.id)
  const movedPoleFrame = moved.mountingBoxes.find(({ id }) => id === poleFrame.id)
  assert.ok(movedIndoorFrame.nodeIds.includes('camera'))
  assert.equal(movedPoleFrame.nodeIds.includes('camera'), false)
  assert.equal(model.mountingGroups.find(({ hostId }) => hostId === 'pole').childIds.includes('camera'), true)
})

test('direct JB and camera share a matching Non-tiang frame while independent assets stay apart', () => {
  const area = 'branch-area'
  const assets = [
    { id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: area },
    { id: 'jb', name: 'JB-10.1', type: 'Junction Box', topologyRole: 'junction',
      mountingExpectation: 'standalone', locationGroupKey: area },
    { id: 'camera', name: 'C-34', type: 'CCTV', topologyRole: 'endpoint',
      mountingExpectation: 'standalone', locationGroupKey: area },
    { id: 'other', name: 'C-35', type: 'CCTV', topologyRole: 'endpoint',
      mountingExpectation: 'standalone', locationGroupKey: area },
    { id: 'indoor', name: 'C-36', type: 'CCTV', topologyRole: 'endpoint',
      mountingExpectation: 'indoor', locationGroupKey: area },
  ]
  const edges = [
    { id: 'server-jb', sourceNodeId: 'server', targetNodeId: 'jb', relationStatus: 'confirmed' },
    { id: 'jb-camera', sourceNodeId: 'jb', targetNodeId: 'camera', relationStatus: 'confirmed' },
    { id: 'jb-indoor', sourceNodeId: 'jb', targetNodeId: 'indoor', relationStatus: 'confirmed' },
  ]
  const model = buildTopologyDiagramModel({ assets, graph: { nodes: assets, edges },
    roots: ['server'], locationGroups: [{ key: area, name: area }] })
  const layout = calculateTopologyDiagramLayout(model)
  const frame = id => layout.mountingBoxes.find(box => box.nodeIds.includes(id))
  assert.equal(frame('jb').id, frame('camera').id)
  assert.notEqual(frame('jb').id, frame('other').id)
  assert.notEqual(frame('jb').id, frame('indoor').id)
  const moved = calculateTopologyDiagramLayout(model, {
    frameAssignments: { camera: frame('other').id },
  })
  assert.equal(moved.mountingBoxes.find(box => box.nodeIds.includes('camera')).id, frame('other').id)
})

test('independent network branches mounted on one pole share its physical frame', () => {
  const area = 'branch-area'
  const assets = [
    { id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: area },
    { id: 'pole', name: 'T-10', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area },
    ...['a', 'b'].flatMap(suffix => [
      { id: `jb-${suffix}`, name: `JB-${suffix}`, type: 'Junction Box', topologyRole: 'junction',
        mountingExpectation: 'pole', locationGroupKey: area },
      { id: `cam-${suffix}`, name: `Cam-${suffix}`, type: 'CCTV', topologyRole: 'endpoint',
        mountingExpectation: 'pole', locationGroupKey: area },
    ]),
  ]
  const edges = ['a', 'b'].flatMap(suffix => [
    { id: `server-${suffix}`, sourceNodeId: 'server', targetNodeId: `jb-${suffix}`, relationStatus: 'confirmed' },
    { id: `branch-${suffix}`, sourceNodeId: `jb-${suffix}`, targetNodeId: `cam-${suffix}`, relationStatus: 'confirmed' },
  ])
  const mountingRelations = ['jb-a', 'cam-a', 'jb-b', 'cam-b'].map(sourceAssetId => ({
    sourceAssetId, targetAssetId: 'pole', relationType: 'mounted_on', verificationStatus: 'confirmed',
  }))
  const model = buildTopologyDiagramModel({ assets, graph: { nodes: assets, edges },
    roots: ['server'], mountingRelations, locationGroups: [{ key: area, name: area }] })
  const layout = calculateTopologyDiagramLayout(model)
  const frame = id => layout.mountingBoxes.find(box => box.nodeIds.includes(id))
  assert.equal(frame('jb-a').id, frame('cam-a').id)
  assert.equal(frame('jb-b').id, frame('cam-b').id)
  assert.equal(frame('jb-a').id, frame('jb-b').id)
  assert.equal(frame('jb-a').id, 'pole-group:pole')
  assert.deepEqual(new Set(frame('jb-a').nodeIds), new Set(['jb-a', 'cam-a', 'jb-b', 'cam-b']))
  assert.equal(layout.mountingBoxes.filter(box => box.hostId === 'pole').length, 1)
  assert.equal(new Set(layout.nodes.map(node => node.id)).size, layout.nodes.length)
  assert.equal(layout.edges.length, edges.length)
  assert.deepEqual(calculateTopologyDiagramLayout(model).mountingBoxes.map(box => box.id),
    layout.mountingBoxes.map(box => box.id))
})

for (const [targetPoleName, existingJbName] of [
  ['T-002', 'JB-002-EXP'],
  ['T-004', 'JB-004-EXP'],
]) test(`moving JB-001 to ${targetPoleName} aligns independent JBs after reload`, () => {
  const area = 'area-a'
  const assets = [
    ['core', 'Server', 'Server Rack', 'core'],
    ['pole-1', 'T-001', 'Pole', 'physical_mount'],
    ['pole-2', targetPoleName, 'Pole', 'physical_mount'],
    ['jb-1', 'JB-001', 'Junction Box', 'junction'],
    ['jb-2', existingJbName, 'Junction Box', 'junction_extended'],
    ['cam-9', 'C-009-Fix', 'CCTV', 'endpoint'],
    ['cam-14', 'C-014-Fix', 'CCTV', 'endpoint'],
    ['cam-31', 'C-031-Fix', 'CCTV', 'endpoint'],
    ['cam-32', 'C-032', 'CCTV', 'endpoint'],
    ['indoor', 'C-Indoor', 'CCTV', 'endpoint'],
  ].map(([id, name, type, topologyRole]) => ({
    id, name, type, topologyRole, locationGroupKey: area,
    ...(id === 'indoor' ? { mountingExpectation: 'indoor' } : {}),
  }))
  const edges = [
    ['core', 'jb-1'], ['core', 'jb-2'], ['jb-1', 'cam-9'],
    ['jb-2', 'cam-14'], ['jb-2', 'cam-31'], ['jb-2', 'cam-32'], ['jb-2', 'indoor'],
  ].map(([sourceNodeId, targetNodeId]) => ({
    id: `${sourceNodeId}-${targetNodeId}`, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
  }))
  const initialMounts = [
    ['jb-1', 'pole-1'], ['cam-9', 'pole-1'],
    ['jb-2', 'pole-2'], ['cam-14', 'pole-2'], ['cam-31', 'pole-2'], ['cam-32', 'pole-2'],
  ].map(([sourceAssetId, targetAssetId]) => ({
    sourceAssetId, targetAssetId, relationType: 'mounted_on', verificationStatus: 'confirmed',
  }))
  const build = mountingRelations => buildTopologyDiagramModel({
    assets, graph: { nodes: assets, edges }, roots: ['core'], mountingRelations,
    locationGroups: [{ key: area, name: area }], area,
  })
  const initial = calculateTopologyDiagramLayout(build(initialMounts))
  assert.deepEqual(new Set(initial.mountingBoxes.find(box => box.hostId === 'pole-1').nodeIds),
    new Set(['jb-1', 'cam-9']))

  const savedMounts = initialMounts.map(relation => relation.sourceAssetId === 'jb-1'
    ? { ...relation, targetAssetId: 'pole-2', provenance: 'manual_admin' } : relation)
  for (const mountingRelations of [savedMounts, structuredClone(savedMounts)]) {
    const layout = calculateTopologyDiagramLayout(build(mountingRelations))
    const poleOne = layout.mountingBoxes.filter(box => box.hostId === 'pole-1')
    const poleTwo = layout.mountingBoxes.filter(box => box.hostId === 'pole-2')
    assert.equal(poleOne.length, 1)
    assert.equal(poleTwo.length, 1)
    assert.deepEqual(poleOne[0].nodeIds, ['cam-9'])
    assert.deepEqual(new Set(poleTwo[0].nodeIds),
      new Set(['jb-1', 'jb-2', 'cam-14', 'cam-31', 'cam-32']))
    const byId = new Map(layout.nodes.map(node => [node.id, node]))
    assert.equal(byId.get('jb-1').rowIndex, 0)
    assert.equal(byId.get('jb-2').rowIndex, 0)
    assert.equal(byId.get('jb-1').diagram.y, byId.get('jb-2').diagram.y)
    for (const cameraId of ['cam-14', 'cam-31', 'cam-32']) {
      assert.equal(byId.get(cameraId).layoutParentId, 'jb-2')
      assert.ok(byId.get(cameraId).diagram.y > byId.get('jb-2').diagram.y)
    }
    assert.equal(byId.get('cam-9').mountingBoxId, poleOne[0].id)
    assert.ok(layout.edges.some(edge => [edge.sourceId, edge.targetId].includes('jb-1')
      && [edge.sourceId, edge.targetId].includes('cam-9')))
    assert.equal(layout.mountingBoxes.find(box => box.nodeIds.includes('indoor')).kind, 'excluded')
    assert.equal(new Set(layout.nodes.map(node => node.id)).size, layout.nodes.length)
    assert.equal(layout.edges.length, edges.length)
    for (let left = 0; left < poleTwo[0].nodes.length; left++) {
      for (let right = left + 1; right < poleTwo[0].nodes.length; right++) {
        const a = poleTwo[0].nodes[left].diagram, b = poleTwo[0].nodes[right].diagram
        assert.equal(a.x < b.x + b.width && a.x + a.width > b.x
          && a.y < b.y + b.height && a.y + a.height > b.y, false)
      }
    }
    for (let left = 0; left < layout.mountingBoxes.length; left++) {
      for (let right = left + 1; right < layout.mountingBoxes.length; right++) {
        const a = layout.mountingBoxes[left], b = layout.mountingBoxes[right]
        assert.equal(a.x < b.x + b.width && a.x + a.width > b.x
          && a.y < b.y + b.height && a.y + a.height > b.y, false)
      }
    }
  }
})

test('confirmed JB-to-JB relation inside one pole keeps the child below its parent', () => {
  const area = 'pole-branch'
  const assets = [
    { id: 'pole', name: 'T-002', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area },
    { id: 'parent', name: 'JB-001', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: area },
    { id: 'child', name: 'JB-002-EXP', type: 'Junction Box', topologyRole: 'junction_extended', locationGroupKey: area },
    { id: 'camera', name: 'C-014', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: area },
  ]
  const edges = [
    { id: 'parent-child', sourceNodeId: 'parent', targetNodeId: 'child', relationStatus: 'confirmed' },
    { id: 'child-camera', sourceNodeId: 'child', targetNodeId: 'camera', relationStatus: 'confirmed' },
  ]
  const model = buildTopologyDiagramModel({
    assets, graph: { nodes: assets, edges }, roots: ['parent'],
    mountingRelations: ['parent', 'child', 'camera'].map(sourceAssetId => ({
      sourceAssetId, targetAssetId: 'pole', relationType: 'mounted_on', verificationStatus: 'confirmed',
    })),
    locationGroups: [{ key: area, name: area }], area,
  })
  const layout = calculateTopologyDiagramLayout(model)
  const frame = layout.mountingBoxes.find(box => box.hostId === 'pole')
  const byId = new Map(layout.nodes.map(node => [node.id, node]))
  assert.equal(layout.mountingBoxes.filter(box => box.hostId === 'pole').length, 1)
  assert.deepEqual(new Set(frame.nodeIds), new Set(['parent', 'child', 'camera']))
  assert.equal(byId.get('parent').rowIndex, 0)
  assert.equal(byId.get('child').rowIndex, 1)
  assert.equal(byId.get('child').layoutParentId, 'parent')
  assert.equal(byId.get('camera').layoutParentId, 'child')
  assert.ok(byId.get('camera').diagram.y > byId.get('child').diagram.y)
  assert.equal(layout.edges.length, edges.length)
})

test('legacy branch and satellite frame assignments resolve to the canonical pole frame', () => {
  const area = 'area-a'
  const assets = [
    { id: 'pole-1', name: 'T-001', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area },
    { id: 'pole-2', name: 'T-002', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area },
    { id: 'jb-1', name: 'JB-001', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: area },
    { id: 'cam-9', name: 'C-009', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: area },
    { id: 'jb-2', name: 'JB-002', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: area },
  ]
  const model = buildTopologyDiagramModel({
    assets, graph: { nodes: assets, edges: [
      { id: 'jb-camera', sourceNodeId: 'jb-1', targetNodeId: 'cam-9', relationStatus: 'confirmed' },
    ] },
    mountingRelations: ['jb-1', 'cam-9'].map(sourceAssetId => ({
      sourceAssetId, targetAssetId: 'pole-1', relationType: 'mounted_on',
    })),
    locationGroups: [{ key: area, name: area }], area,
  })
  const layout = calculateTopologyDiagramLayout(model, { frameAssignments: {
    'jb-1': 'pole-group:pole-2:branch:jb-1',
    'cam-9': 'pole-group:pole-2:junction:jb-1',
  } })
  assert.deepEqual(new Set(layout.mountingBoxes.find(box => box.id === 'pole-group:pole-2').nodeIds),
    new Set(['jb-1', 'cam-9']))
  assert.equal(layout.mountingBoxes.filter(box => box.hostId === 'pole-2').length, 1)
  assert.deepEqual(model.mountingGroups.find(group => group.hostId === 'pole-1').childIds,
    ['cam-9', 'jb-1'])
})

test('custom Non-tiang frame aligns sibling JBs with their camera columns', () => {
  for (const count of [3, 4, 5]) {
    const area = 'branch-area'
    const frameId = `excluded-mounting:${area}:custom:siblings`
    const extensions = Array.from({length: count}, (_, index) => `jb-${index + 2}`)
    const cameras = Array.from({length: count}, (_, index) => `camera-${index + 2}`)
    const assets = [
      {id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: area},
      {id: 'pole', name: 'T-04', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area},
      {id: 'base', name: 'JB-02', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: area},
      ...extensions.map((id, index) => ({id, name: `JB-02.${index + 2}`,
        type: 'Junction Box', topologyRole: 'junction_extended', locationGroupKey: area})),
      ...cameras.map((id, index) => ({id, name: `C-${index + 14}`,
        type: 'CCTV', topologyRole: 'endpoint', mountingExpectation: 'indoor', locationGroupKey: area})),
    ]
    const edges = [
      {id: 'server-base', sourceNodeId: 'server', targetNodeId: 'base', relationStatus: 'confirmed'},
      ...extensions.flatMap((id, index) => [
        {id: `base-${id}`, sourceNodeId: 'base', targetNodeId: id, relationStatus: 'confirmed'},
        {id: `${id}-${cameras[index]}`, sourceNodeId: id,
          targetNodeId: cameras[index], relationStatus: 'confirmed'},
      ]),
    ]
    const model = buildTopologyDiagramModel({assets, graph: {nodes: assets, edges},
      mountingRelations: [{sourceAssetId: 'base', targetAssetId: 'pole', relationType: 'mounted_on'}],
      locationGroups: [{key: area, name: area}]})
    const options = {mountingRootFrameGap: 64,
      frameAssignments: Object.fromEntries(extensions.map(id => [id, frameId])),
      customFrames: {[frameId]: {id: frameId, type: 'non-pole', areaKey: area, name: 'Non-tiang'}}}
    const layout = calculateTopologyDiagramLayout(model, options)
    const frame = layout.mountingBoxes.find(box => box.id === frameId)
    const pole = layout.mountingBoxes.find(box => box.hostId === 'pole')
    assert.equal(frame.layoutParentBoxId, pole.id)
    assert.ok(frame.y >= pole.y + pole.height)
    assert.equal(frame.siblingJunctionGrid, true)
    assert.equal(frame.nodes.length, count)
    const junctions = extensions.map(id => layout.nodes.find(node => node.id === id))
    const cameraFrames = cameras.map(id => layout.mountingBoxes.find(box => box.nodeIds.includes(id)))
    for (let index = 0; index < count; index++) {
      assert.equal(cameraFrames[index].layoutParentBoxId, frame.id)
      assert.equal(cameraFrames[index].layoutParentNodeId, extensions[index])
      assert.equal(cameraFrames[index].x + cameraFrames[index].width / 2,
        junctions[index].diagram.centerX)
      assert.ok(cameraFrames[index].y >= frame.y + frame.height)
    }
    assert.deepEqual(junctions.slice(0, 3).map(node => node.diagram.centerY),
      Array(3).fill(junctions[0].diagram.centerY))
    if (count > 3) assert.ok(junctions[3].diagram.centerY > junctions[0].diagram.centerY)
    assert.equal(layout.edges.length, edges.length)
    assert.equal(layout.nodes.length, assets.length - 1)
    const rebuilt = calculateTopologyDiagramLayout(model, options)
    assert.deepEqual(rebuilt.mountingBoxes.map(box => [box.id, box.x, box.y, box.width, box.height]),
      layout.mountingBoxes.map(box => [box.id, box.x, box.y, box.width, box.height]))
    const otherAreaLayout = calculateTopologyDiagramLayout(model,
      {...options, mountingRootFrameGap: null})
    const otherAreaFrame = otherAreaLayout.mountingBoxes.find(box => box.id === frameId)
    assert.equal(otherAreaFrame.siblingJunctionGrid, true)
    assertEdgesAvoidOtherFrames(otherAreaLayout)
    assertEdgesAvoidOtherNodes(otherAreaLayout)
    assert.equal(model.edges.length, edges.length)
    assert.equal(model.mountingGroups.find(group => group.hostId === 'pole').childIds.includes('base'), true)
    assertEdgesAvoidOtherFrames(layout)
    assertEdgesAvoidOtherNodes(layout)
    for (let left = 0; left < layout.mountingBoxes.length; left++) {
      for (let right = left + 1; right < layout.mountingBoxes.length; right++) {
        const a = layout.mountingBoxes[left], b = layout.mountingBoxes[right]
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x
          || a.y + a.height <= b.y || b.y + b.height <= a.y)
      }
    }
  }
})

test('custom Indoor and selected empty-pole frames stay visible before assets are dropped into them', () => {
  const area = 'area-a'
  const assets = [
    { id: 'server', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: area },
    { id: 'pole-empty', name: 'Tiang 02', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: area },
  ]
  const model = buildTopologyDiagramModel({ assets,
    graph: { nodes: assets, edges: [] },
    locationGroups: [{ key: area, name: 'Area A' }],
  })
  const indoorId = `excluded-mounting:${area}:custom:frame-1`
  const poleId = 'pole-group:pole-empty'
  const layout = calculateTopologyDiagramLayout(model, { customFrames: {
    [indoorId]: { id: indoorId, type: 'indoor', areaKey: area, name: 'Indoor' },
    [poleId]: { id: poleId, type: 'pole', areaKey: area, poleAssetId: 'pole-empty', name: 'Tiang 02' },
  } })

  const indoor = layout.mountingBoxes.find(({ id }) => id === indoorId)
  const pole = layout.mountingBoxes.find(({ id }) => id === poleId)
  assert.equal(indoor?.kind, 'excluded')
  assert.deepEqual(indoor?.nodeIds, [])
  assert.equal(pole?.kind, 'empty')
  assert.equal(pole?.hostId, 'pole-empty')
})

test('a camera stays in its physical pole frame even when its network owner is elsewhere', () => {
  for (const area of ['booster-kutawinangun', 'dppu-yia', 'ft-tegal-baru', 'unlisted-facility']) {
    for (const extended of [false, true]) {
      const assets = [
        ['root', 'Server', 'Server Rack', 'core'],
        ['owner', extended ? 'JB-02.2' : 'JB-02', 'Junction Box', extended ? 'junction_extended' : 'junction'],
        ['other', 'JB-06', 'Junction Box', 'junction'],
        ['camera', 'Cam-13', 'CCTV', 'endpoint'],
        ['local', 'Cam-16', 'CCTV', 'endpoint'],
        ['pole', 'T-08', 'Pole', 'physical_mount'],
      ].map(([id, name, type, topologyRole]) => ({id, name, type, topologyRole, locationGroupKey: area}))
      const edges = [['root', 'owner'], ['root', 'other'], ['camera', 'owner'], ['other', 'local']]
        .map(([sourceNodeId, targetNodeId]) => ({id: `${sourceNodeId}:${targetNodeId}`,
          sourceNodeId, targetNodeId, relationStatus: 'confirmed'}))
      const mounts = ['other', 'camera', 'local'].map(sourceAssetId => ({
        sourceAssetId, targetAssetId: 'pole', relationType: 'mounted_on', verificationStatus: 'confirmed',
      }))
      const model = buildTopologyDiagramModel({assets, roots: ['root'], graph: {nodes: assets, edges},
        mountingRelations: mounts, locationGroups: [{key: area, name: area}]})
      const before = JSON.stringify(model.mountingGroups)
      for (const layoutStyle of ['central-backbone', 'compound-poles', 'facility-schematic']) {
        const layout = calculateTopologyDiagramLayout(model, {layoutStyle})
        const frame = id => layout.mountingBoxes.find(box => box.nodeIds.includes(id))
        assert.equal(frame('camera').id, frame('other').id)
        assert.notEqual(frame('camera').id, frame('owner').id)
        assert.equal(layout.mountingBoxes.filter(box => box.hostId === 'pole').length, 1)
        assert.equal(frame('camera').hostId, 'pole', 'physical mounting is preserved separately')
        assert.equal(frame('local').id, frame('other').id)
        assert.equal(layout.nodes.filter(node => node.id === 'camera').length, 1)
        assert.ok(layout.edges.some(edge => (
          [edge.sourceId, edge.targetId].includes('camera')
            && [edge.sourceId, edge.targetId].includes('owner')
        )))
        assert.equal(layout.edges.length, edges.length)
        assert.equal(JSON.stringify(model.mountingGroups), before)
      }
    }
  }
})

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
  assert.equal(layout.mountingBoxes.length, 2)
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
    assert.ok(edge.routePoints.length <= 5, 'edge uses hierarchy whitespace or the outer frame gutter')
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
  assert.equal(indoorBox.label, 'Indoor · Cam-05')
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
    { id: 'local-cam', name: 'C-001', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'cam-11', name: 'C-037', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
  ]
  const edges = [
    ['core-1', 'core', 'base-1'],
    ['core-11', 'core', 'base-11'],
    ['base-child-1', 'base-1', 'child-1'],
    ['base-child-11', 'base-11', 'child-11'],
    ['child-cam-1', 'child-1', 'cam-1'],
    ['base-local-cam', 'base-1', 'local-cam'],
    ['child-cam-11', 'child-11', 'cam-11'],
  ].map(([id, sourceNodeId, targetNodeId]) => ({
    id, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
  }))
  const mountingRelations = [
    ['mount-base-1', 'base-1', 'pole-1'],
    ['mount-base-11', 'base-11', 'pole-11'],
    ['mount-child-1', 'child-1', 'pole-19'],
    ['mount-cam-1', 'cam-1', 'pole-19'],
    ['mount-local-cam', 'local-cam', 'pole-1'],
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
      x: byId.get(baseId).diagram.centerX + (baseId === 'base-1' ? 22 : 0),
      y: byId.get(baseId).diagram.centerY + (baseId === 'base-1' ? 0 : 19),
    })
    assert.deepEqual(route.at(-1), {
      x: byId.get(childId).diagram.centerX,
      y: byId.get(childId).diagram.centerY - 19,
    })
    if (baseId === 'base-1') assert.ok(route[1].x > parentBox.x + parentBox.width,
      'downstream cable uses the outer gutter instead of crossing local devices')
    for (let index = 1; index < route.length; index++) {
      const a = route[index - 1], b = route[index]
      assert.ok(a.x === b.x || a.y === b.y, 'every cable segment is orthogonal')
      const camera = byId.get('local-cam').diagram
      const crosses = a.x === b.x
        ? a.x > camera.x && a.x < camera.x + camera.width
          && Math.max(a.y, b.y) > camera.y && Math.min(a.y, b.y) < camera.y + camera.height + 28
        : a.y > camera.y && a.y < camera.y + camera.height + 28
          && Math.max(a.x, b.x) > camera.x && Math.min(a.x, b.x) < camera.x + camera.width
      assert.equal(crosses, false, 'downstream cable avoids the local camera and its label')
    }
  }
  assert.equal(boxes.get('pole-group:pole-1').y, boxes.get('pole-group:pole-11').y)
})

test('DPPU YIA orders poles and preserves cross-pole JB parent families', () => {
  const pole = (id, name) => ({
    id,
    name,
    type: 'Pole',
    topologyRole: 'physical_mount',
    locationGroupKey: 'dppu-yia',
  })
  const jb = (id, name, topologyRole = 'junction') => ({
    id,
    name,
    type: topologyRole === 'junction_extended' ? 'JB Extended' : 'Junction Box',
    topologyRole,
    locationGroupKey: 'dppu-yia',
  })
  const camera = (id, name, mountingExpectation = 'pole') => ({
    id,
    name,
    type: 'CCTV',
    topologyRole: 'endpoint',
    mountingExpectation,
    locationGroupKey: 'dppu-yia',
  })
  const assets = [
    { id: 'server', name: 'SERVER', type: 'Server Rack', topologyRole: 'root', locationGroupKey: 'dppu-yia' },
    ...[
      ['pole-1', 'T-001'], ['pole-2', 'T-002'], ['pole-3', 'T-003'], ['pole-4', 'T-004'],
      ['pole-5', 'T-005'], ['pole-6', 'T-006'], ['pole-7', 'T-007'],
      ['pole-8', 'T-008'], ['pole-16', 'T-016'],
    ].map(([id, name]) => pole(id, name)),
    jb('jb-08', 'JB-CCTV-08-WP'),
    jb('jb-09', 'JB-CCTV-09-WP'),
    jb('jb-091', 'JB-CCTV-09.1-WP', 'junction_extended'),
    jb('jb-15', 'JB-CCTV-15-WP'),
    jb('jb-151', 'JB-CCTV-15.1-WP', 'junction_extended'),
    jb('jb-152', 'JB-CCTV-15.2-WP', 'junction_extended'),
    camera('bc-17', 'BC-017'), camera('bc-18', 'BC-018'), camera('bc-21', 'BC-021'),
    camera('bc-37', 'BC-037'), camera('bc-38', 'BC-038'), camera('bc-41', 'BC-041'),
    camera('bc-42', 'BC-042'),
    camera('dc-39', 'DC-039', 'indoor'), camera('dc-40', 'DC-040', 'indoor'),
  ]
  const edge = (id, sourceNodeId, targetNodeId) => ({
    id, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
  })
  const graphEdges = [
    edge('server-08', 'server', 'jb-08'),
    edge('08-17', 'jb-08', 'bc-17'), edge('08-18', 'jb-08', 'bc-18'),
    edge('09-091', 'jb-09', 'jb-091'),
    edge('091-21', 'jb-091', 'bc-21'),
    edge('15-151', 'jb-15', 'jb-151'), edge('15-152', 'jb-15', 'jb-152'),
    edge('151-37', 'jb-151', 'bc-37'), edge('151-38', 'jb-151', 'bc-38'),
    edge('152-41', 'jb-152', 'bc-41'), edge('152-39', 'jb-152', 'dc-39'),
    edge('15-40', 'jb-15', 'dc-40'),
  ]
  const mount = (id, sourceAssetId, targetAssetId) => ({
    id, relationType: 'mounted_on', sourceAssetId, targetAssetId,
  })
  const mountingRelations = [
    mount('m-08', 'jb-08', 'pole-4'), mount('m-17', 'bc-17', 'pole-4'),
    mount('m-18', 'bc-18', 'pole-4'), mount('m-09', 'jb-09', 'pole-6'),
    mount('m-091', 'jb-091', 'pole-5'), mount('m-21', 'bc-21', 'pole-5'),
    mount('m-152', 'jb-152', 'pole-7'), mount('m-41', 'bc-41', 'pole-7'),
    mount('m-39', 'dc-39', 'pole-7'), mount('m-151', 'jb-151', 'pole-8'),
    mount('m-37', 'bc-37', 'pole-8'), mount('m-38', 'bc-38', 'pole-8'),
    mount('m-42', 'bc-42', 'pole-16'),
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'dppu-yia-presentation',
      nodes: assets.filter(({ topologyRole }) => topologyRole !== 'physical_mount'),
      edges: graphEdges,
    },
    roots: ['server'],
    mountingRelations,
    locationGroups: [{ key: 'dppu-yia', name: 'DPPU YIA' }],
    area: 'dppu-yia',
  })
  const layout = calculateTopologyDiagramLayout(model)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const boxes = new Map(layout.mountingBoxes.map((box) => [box.label, box]))
  assert.deepEqual(
    ['T-001', 'T-002', 'T-003', 'T-004', 'T-005', 'T-006', 'T-007', 'T-008', 'T-016'],
    layout.mountingBoxes.filter((box) => /^T-\d+$/.test(box.label)).map((box) => box.label),
  )
  assert.equal(boxes.get('T-016').kind, 'confirmed')
  assert.deepEqual(boxes.get('T-016').nodeIds, ['bc-42'])
  assert.equal(layout.nodes.filter(({ id }) => id === 'bc-42').length, 1)
  assert.equal(boxes.get('T-005').layoutParentBoxId, boxes.get('T-006').id)
  assert.equal(byId.get('jb-091').layoutParentId, 'jb-09')
  assert.deepEqual(new Set(boxes.get('T-005').nodeIds), new Set(['jb-091', 'bc-21']))
  assert.equal(layout.edges.some(({ sourceNodeId, targetNodeId }) => (
    new Set([sourceNodeId, targetNodeId]).has('jb-08')
    && new Set([sourceNodeId, targetNodeId]).has('jb-091')
  )), false)
  assert.deepEqual(new Set(boxes.get('T-007').nodeIds), new Set(['jb-152', 'bc-41', 'dc-39']))
  assert.deepEqual(new Set(boxes.get('T-008').nodeIds), new Set(['jb-151', 'bc-37', 'bc-38']))
  const jb15Frame = layout.mountingBoxes.find(box => box.nodeIds.includes('jb-15'))
  const dc40Frame = layout.mountingBoxes.find(box => box.nodeIds.includes('dc-40'))
  assert.notEqual(jb15Frame.id, dc40Frame.id)
  assert.equal(dc40Frame.layoutParentBoxId, jb15Frame.id)
  assert.ok(dc40Frame.y > jb15Frame.y)
  assert.equal(new Set(layout.nodes.map(({ id }) => id)).size, layout.nodes.length)
  assert.equal(layout.edges.length, graphEdges.length)
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
