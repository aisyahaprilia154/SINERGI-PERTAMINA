import assert from 'node:assert/strict'
import test from 'node:test'
import {routeSchematicEdges} from '../src/pages/topology/topology-obstacle-router.js'
import {calculateTopologyDiagramLayout} from '../src/pages/topology/topology-diagram-layout.js'
import {buildTopologyDiagramModel} from '../src/domain/topology-diagram-model.js'
import {lineJumpPaths} from '../src/pages/topology/topology-line-jumps.js'
import {renderTopologyDiagramSvg} from '../src/pages/topology/topology-diagram-svg.js'

const card = (id, x, y) => ({id, diagram: {x, y, width: 168, height: 64}})
const edge = (sourceId, targetId) => ({id: `${sourceId}-${targetId}`, sourceId, targetId})

test('rounded connectors preserve ports and limit corners on short segments', () => {
  const paths = lineJumpPaths([{id: 'elbow', sourceId: 'a', targetId: 'b', routePoints: [
    {x: 0, y: 0}, {x: 0, y: 40}, {x: 80, y: 40}, {x: 80, y: 44},
  ]}])
  const path = paths.get('elbow')
  assert.match(path, /^M 0 0 L 0 32 Q 0 40 8 40/)
  assert.match(path, /L 78 40 Q 80 40 80 42 L 80 44$/)
})

function assertNoCardCrossings(nodes, edges) {
  for (const edge of edges) for (let i = 1; i < edge.routePoints.length; i++) {
    const a = edge.routePoints[i - 1], b = edge.routePoints[i]
    assert.ok(a.x === b.x || a.y === b.y, 'orthogonal segments')
    for (const node of nodes) {
      const r = node.diagram
      const crossing = a.x === b.x
        ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
        : a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width
      assert.equal(crossing, false, `${edge.id} crosses ${node.id}`)
    }
  }
}

test('repeated installations use identical outside-frame bends regardless of edge order', () => {
  const nodes = [], frames = [], edges = []
  for (const [index, x] of [0, 400, 800].entries()) {
    nodes.push(card(`jb${index}`, x + 24, 64), card(`cam${index}`, x + 24, 176),
      card(`child${index}`, x + 24, 344))
    frames.push({id: `top${index}`, x, y: 0, width: 216, height: 264,
      nodeIds: [`jb${index}`, `cam${index}`]},
    {id: `bottom${index}`, x, y: 280, width: 216, height: 160, nodeIds: [`child${index}`]})
    edges.push(edge(`jb${index}`, `child${index}`), edge(`jb${index}`, `cam${index}`))
  }
  const routed = routeSchematicEdges(nodes, edges, frames)
  assert.equal(Math.abs(routed[0].routePoints[0].x - routed[1].routePoints[0].x), 20,
    'connections leaving the same JB have separate ports')
  assertNoCardCrossings(nodes, routed)
  const shapes = [0, 1, 2].map(i => routed.find(e => e.id === `jb${i}-child${i}`)
    .routePoints.map(p => ({x: p.x - i * 400, y: p.y})))
  assert.deepEqual(shapes[0], shapes[1])
  assert.deepEqual(shapes[1], shapes[2])
  const reversed = routeSchematicEdges(nodes, [...edges].reverse(), frames)
  for (const route of routed) assert.deepEqual(route.routePoints,
    reversed.find(e => e.id === route.id).routePoints)
})

test('schematic routes avoid intervening cards and reroute after a card moves', () => {
  const nodes = [card('a', 0, 0), card('block', 0, 130), card('b', 0, 260)]
  const before = routeSchematicEdges(nodes, [edge('a', 'b')])
  assertNoCardCrossings(nodes, before)
  nodes[1].diagram.x = 300
  const after = routeSchematicEdges(nodes, [edge('a', 'b')])
  assertNoCardCrossings(nodes, after)
  assert.equal(after[0].routePoints.length, 2, 'clear corridor remains a straight line')
})

test('edge crossings are allowed without detours or synthetic junctions', () => {
  const nodes = [card('top', 216, 0), card('bottom', 216, 400),
    card('left', 0, 200), card('right', 432, 200)]
  const routes = routeSchematicEdges(nodes, [edge('top', 'bottom'), edge('left', 'right')])
  assertNoCardCrossings(nodes, routes)
  assert.deepEqual(routes.map(edge => edge.routePoints.length), [2, 2])
  const paths = lineJumpPaths(routes)
  assert.match(paths.get('left-right'), / Q /, 'unrelated crossing gets a jump')
  const shared = routes.map(route => ({...route, sourceId: 'shared'}))
  assert.ok([...lineJumpPaths(shared).values()].every(path => !path.includes(' Q ')), 'shared trunks do not jump')
})

test('four sibling JBs never wrap into a false downstream tier', () => {
  const assets = ['root', 'JB-01', 'JB-01.1', 'JB-01.2', 'JB-01.3', 'JB-01.4'].map(id => ({
    id, name: id, locationGroupKey: 'site', type: id === 'root' ? 'Server Rack' : 'Junction Box',
    topologyRole: id === 'root' ? 'core' : 'junction',
  }))
  const model = buildTopologyDiagramModel({assets, roots: ['root'],
    graph: {nodes: assets, edges: assets.slice(1).map(node => ({id: node.id,
      sourceNodeId: node.id === 'JB-01' ? 'root' : 'JB-01', targetNodeId: node.id,
      relationStatus: 'confirmed',
    }))}, locationGroups: [{key: 'site', name: 'Site'}],
  })
  const layout = calculateTopologyDiagramLayout(model, {layoutStyle: 'facility-schematic'})
  const siblings = layout.nodes.filter(node => node.id.startsWith('JB-01.'))
  assert.equal(siblings.length, 4)
  assert.equal(new Set(siblings.map(node => node.diagram.y)).size, 1)
  assertNoCardCrossings(layout.nodes, layout.edges)
})

test('card design preserves main mounting hierarchy and horizontal ordering', () => {
  const assets = ['root', 'a', 'b', 'c', 'd', 'indoor', 'cam', 'pa', 'pb', 'pc', 'pd'].map(id => ({
    id, name: id, locationGroupKey: 'site',
    type: id.startsWith('p') ? 'Pole' : id === 'root' ? 'Server Rack'
      : ['indoor', 'cam'].includes(id) ? 'CCTV' : 'Junction Box',
    topologyRole: id.startsWith('p') ? 'physical_mount' : id === 'root' ? 'core'
      : ['indoor', 'cam'].includes(id) ? 'endpoint' : 'junction',
    ...(id === 'indoor' ? {mountingExpectation: 'indoor'} : {}),
  }))
  const relations = [['root', 'a'], ['root', 'b'], ['a', 'c'], ['b', 'd'], ['a', 'cam'], ['a', 'indoor']]
  const model = buildTopologyDiagramModel({assets, roots: ['root'],
    graph: {nodes: assets, edges: relations.map(([sourceNodeId, targetNodeId]) => ({
      id: `${sourceNodeId}-${targetNodeId}`, sourceNodeId, targetNodeId, relationStatus: 'confirmed',
    }))},
    mountingRelations: [['a', 'pa'], ['b', 'pb'], ['c', 'pc'], ['d', 'pd'], ['cam', 'pa']]
      .map(([sourceAssetId, targetAssetId]) => ({sourceAssetId, targetAssetId, relationType: 'mounted_on'})),
    locationGroups: [{key: 'site', name: 'Site'}],
  })
  const layout = calculateTopologyDiagramLayout(model, {layoutStyle: 'facility-schematic'})
  const nodes = new Map(layout.nodes.map(node => [node.id, node]))
  assert.equal(nodes.get('a').diagram.y, nodes.get('b').diagram.y)
  assert.equal(nodes.get('c').diagram.y, nodes.get('d').diagram.y)
  const baseline = calculateTopologyDiagramLayout(model, {layoutStyle: 'central-backbone'})
  const order = boxes => [...boxes].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id)).map(box => box.id)
  const junctionBoxes = boxes => boxes.filter(box => box.nodes.some(node =>
    ['junction-peer', 'junction-extended'].includes(node.diagramClass)))
  assert.deepEqual(order(junctionBoxes(layout.mountingBoxes)), order(junctionBoxes(baseline.mountingBoxes)))
  assert.deepEqual(junctionBoxes(layout.mountingBoxes).map(box => [box.id, box.layoutParentBoxId]),
    junctionBoxes(baseline.mountingBoxes).map(box => [box.id, box.layoutParentBoxId]))
  assert.ok(nodes.get('a').diagram.width >= 168)
  const host = layout.mountingBoxes.find(box => box.nodeIds.includes('a'))
  const indoor = layout.mountingBoxes.find(box => box.nodeIds.includes('indoor'))
  assert.notEqual(host.id, indoor.id)
  assert.equal(indoor.connectionLabel, 'Terhubung ke a')
  assert.equal(indoor.layoutParentBoxId, host.id)
  assert.ok(indoor.x >= host.treeX)
  assert.ok(indoor.y > host.y)
  assertNoCardCrossings(layout.nodes, layout.edges)
  assert.equal(layout.edges.length, relations.length)
  const directions = model.edges.map(edge => edge.direction)
  const svg = renderTopologyDiagramSvg({model, layout})
  assert.match(svg, /Terhubung ke a/)
  assert.doesNotMatch(svg, /class="topology-presentation-backbone"/)
  assert.match(svg, /marker-end="url\(#topology-arrow-hierarchy\)"/)
  assert.match(svg, /Panah hierarki tampilan; arah komunikasi belum ditetapkan/)
  assert.deepEqual(model.edges.map(edge => edge.direction), directions)
})

test('export rendering carries a self-describing legend and dataset metadata', () => {
  const model = buildTopologyDiagramModel({
    assets: [{id: 'root', name: 'Gateway Master', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'site'}],
    graph: {nodes: [{id: 'root', topologyRole: 'core'}], edges: []},
    roots: ['root'], locationGroups: [{key: 'site', name: 'Site'}],
  })
  const layout = calculateTopologyDiagramLayout(model, {layoutStyle: 'facility-schematic'})
  const svg = renderTopologyDiagramSvg({model, layout, renderMode: 'export', context: {
    branchName: 'Semarang', datasetVersionId: 'version-42', version: 'Rilis 42',
    publishedAt: '2026-09-15T05:00:00.000Z',
  }})
  assert.match(svg, /LEGENDA · Warna menunjukkan jenis \/ penempatan/)
  assert.match(svg, /Versi Rilis 42/)
  assert.match(svg, /Server/)
  assert.match(svg, /Gateway Master/)
})

test('readable export wraps root groups without shrinking cards or changing asset order', () => {
  const junctions = Array.from({length: 9}, (_, index) => `JB-${index + 1}`)
  const poles = Array.from({length: 9}, (_, index) => `T-${index + 1}`)
  const assets = [
    {id: 'root', name: 'Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'site'},
    ...junctions.map(id => ({id, name: id, type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'site'})),
    ...poles.map(id => ({id, name: id, type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'site'})),
  ]
  const model = buildTopologyDiagramModel({assets, roots: ['root'],
    graph: {nodes: assets, edges: junctions.map(id => ({id: `root-${id}`,
      sourceNodeId: 'root', targetNodeId: id, relationStatus: 'confirmed'}))},
    mountingRelations: junctions.map((id, index) => ({sourceAssetId: id,
      targetAssetId: poles[index], relationType: 'mounted_on'})),
    locationGroups: [{key: 'site', name: 'Site'}],
  })
  const screen = calculateTopologyDiagramLayout(model, {layoutStyle: 'facility-schematic'})
  const rootGroups = [...screen.mountingBoxes].sort((a, b) => a.x - b.x)
  for (let index = 1; index < rootGroups.length; index++) {
    assert.equal(rootGroups[index].x - rootGroups[index - 1].x - rootGroups[index - 1].width, 144,
      'independent JB families have a consistent outer gutter')
  }
  assert.ok(screen.options.mountingRootGapX > screen.options.mountingBoxGapX)
  const exported = calculateTopologyDiagramLayout(model, {
    layoutStyle: 'facility-schematic', mountingRootColumns: 3, mountingRootRowGapY: 96,
  })
  assert.ok(exported.width < screen.width)
  assert.ok(exported.height > screen.height)
  assert.deepEqual(exported.nodes.map(node => node.id).sort(), screen.nodes.map(node => node.id).sort())
  assert.ok(exported.nodes.every(node => node.diagram.width >= 168))
  const svg = renderTopologyDiagramSvg({model, layout: exported, renderMode: 'export'})
  assert.doesNotMatch(svg, /class="topology-presentation-backbone"/)
})
