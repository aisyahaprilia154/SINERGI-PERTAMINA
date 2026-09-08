import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramModel } from '../src/domain/topology-diagram-model.js'
import {
  calculateTopologyDiagramLayout,
} from '../src/pages/topology/topology-diagram-layout.js'
import { renderTopologyDiagramSvg } from '../src/pages/topology/topology-diagram-svg.js'
import { computeFitZoom } from '../src/pages/topology/topology-viewport.js'

function networkFixture(componentCount, areaName) {
  const assets = []
  const edges = []
  for (let index = 0; index < componentCount; index += 1) {
    const coreId = `${areaName}-core-${index}`
    const junctionId = `${areaName}-jb-${index}`
    const endpointId = `${areaName}-camera-${index}`
    assets.push(
      { id: coreId, name: coreId, type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
      { id: junctionId, name: junctionId, type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
      { id: endpointId, name: endpointId, type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    )
    edges.push(
      { id: `${coreId}-junction`, sourceNodeId: coreId, targetNodeId: junctionId, relationStatus: 'confirmed' },
      { id: `${junctionId}-endpoint`, sourceNodeId: junctionId, targetNodeId: endpointId, relationStatus: 'confirmed' },
    )
  }
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: areaName,
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges,
    },
    roots: assets.filter(({ topologyRole }) => topologyRole === 'core').map(({ id }) => id),
    locationGroups: [{ key: 'area-a', name: areaName }],
  })
  return model
}

function countMarkup(markup, token) {
  return markup.split(token).length - 1
}

const BROWSER_VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]

for (const [name, componentCount] of [
  ['Booster Kutawinangun', 5],
  ['FT LOMANIS', 16],
]) {
  for (const viewport of BROWSER_VIEWPORTS) {
    test(`${name} fit geometry stays inside ${viewport.width}x${viewport.height}`, () => {
      const model = networkFixture(componentCount, name)
      const layout = calculateTopologyDiagramLayout(model)
      const fitZoom = computeFitZoom({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
        minZoom: .12,
        maxZoom: 1,
        horizontalPadding: 0,
        verticalPadding: 0,
      })

      // A long per-JB topology remains horizontally scrollable on a narrow
      // viewport once the readable zoom floor is reached.
      assert.ok(layout.width * fitZoom <= viewport.width + .01 || fitZoom === .12)
      assert.ok(layout.height * fitZoom <= viewport.height + .01)
      assert.equal(layout.nodes.length, model.nodes.length)
      assert.equal(layout.sections[0].componentCount, componentCount)
    })
  }
}

test('assets without pole mounting stay grouped under their connected JB', () => {
  const model = networkFixture(16, 'FT LOMANIS')
  const layout = calculateTopologyDiagramLayout(model)

  assert.equal(layout.mountingBoxes.length, 16)
  assert.ok(layout.mountingBoxes.every(({ kind, nodeIds }) => (
    kind === 'unassigned' && nodeIds.length === 2
  )))
  assert.equal(layout.sections[0].componentCount, 16)
})

test('connected JB scope takes precedence over indoor or standalone hints', () => {
  const model = networkFixture(2, 'FT LOMANIS')
  const excludedNodes = model.nodes.filter(({ diagramClass }) => diagramClass !== 'rack-root').slice(0, 2)
  excludedNodes[0].mountingExpectation = 'indoor'
  excludedNodes[1].mountingExpectation = 'standalone'
  const layout = calculateTopologyDiagramLayout(model)
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  assert.ok(excludedNodes.every(({ id }) => byId.get(id).mountingBoxId))
  assert.ok(excludedNodes.every(({ id }) => byId.get(id).mountingRelationStatus === 'unassigned'))
  assert.equal(layout.mountingBoxes.some(({ kind }) => kind === 'excluded'), false)
})

test('pole backbone region keeps every component and SVG node without island cards', () => {
  const model = networkFixture(5, 'Booster Kutawinangun')
  const layout = calculateTopologyDiagramLayout(model)
  const svg = renderTopologyDiagramSvg({
    model,
    layout,
    context: { branchName: 'Test branch' },
    zoom: .6,
    semanticLevel: 'overview',
    renderMode: 'interactive',
  })

  assert.equal(countMarkup(svg, 'class="topology-region-boundary"'), 1)
  assert.equal(countMarkup(svg, 'data-component-id='), 1)
  assert.match(svg, /data-component-id="area:area-a:pole-backbone"/)
  assert.match(svg, /topology-mounting-group unassigned/)
  assert.match(svg, /Aset lainnya/)
  assert.match(svg, /tanpa penempatan tiang/)
  assert.equal(countMarkup(svg, 'data-node-id='), model.nodes.length)
  assert.doesNotMatch(svg, /class="topology-island-boundary"/)
})

test('overview cards omit areas that contain no device asset', () => {
  const model = networkFixture(1, 'Booster Kutawinangun')
  const withEmptyArea = {
    ...model,
    areas: [
      ...model.areas,
      {
        key: 'lainnya',
        name: 'Lainnya',
        nodeIds: [],
        componentIds: [],
        isolatedNodeIds: [],
        suggestedOnlyNodeIds: [],
        unresolved: [],
      },
    ],
  }
  const overview = calculateTopologyDiagramLayout(withEmptyArea, { overview: true })

  assert.deepEqual(overview.overviewAreas.map(({ key }) => key), ['area-a'])
})
