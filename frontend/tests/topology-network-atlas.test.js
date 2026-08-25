import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramModel } from '../src/domain/topology-diagram-model.js'
import {
  calculateTopologyDiagramLayout,
} from '../src/pages/topology/topology-diagram-layout.js'
import {
  getTopologyLabelVisibility,
  renderTopologyDiagramSvg,
} from '../src/pages/topology/topology-diagram-svg.js'

function fixture() {
  const assets = [
    { id: 'core', name: 'Core', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'jb', name: 'JB-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'camera', name: 'CAM-01', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
    { id: 'printer', name: 'PR-01', type: 'Printer', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'atlas-revision',
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'core-jb', sourceNodeId: 'core', targetNodeId: 'jb', relationStatus: 'confirmed' },
        { id: 'jb-camera', sourceNodeId: 'jb', targetNodeId: 'camera', relationStatus: 'confirmed' },
        { id: 'camera-printer', sourceNodeId: 'camera', targetNodeId: 'printer', relationStatus: 'confirmed' },
      ],
    },
    roots: ['core'],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
  })
  return { model, layout: calculateTopologyDiagramLayout(model) }
}

test('atlas presentation metadata classifies tiers and hierarchical edge roles', () => {
  const { model } = fixture()
  assert.equal(model.nodeById.get('core').visualTier, 'core')
  assert.equal(model.nodeById.get('jb').visualTier, 'junction')
  assert.equal(model.nodeById.get('camera').visualTier, 'endpoint')
  assert.equal(model.nodeById.get('core').labelPriority, 0)
  assert.equal(model.nodeById.get('jb').labelPriority, 1)
  assert.equal(model.nodeById.get('camera').labelPriority, 2)
  assert.equal(model.edgeById.get('core-jb').edgeVisualRole, 'backbone')
  assert.equal(model.edgeById.get('jb-camera').edgeVisualRole, 'access')
  assert.equal(model.edgeById.get('camera-printer').edgeVisualRole, 'peer')
})

test('atlas layout keeps compact endpoint leaves and deterministic parent metadata', () => {
  const { model, layout } = fixture()
  const core = layout.nodes.find(({ id }) => id === 'core')
  const junction = layout.nodes.find(({ id }) => id === 'jb')
  const endpoint = layout.nodes.find(({ id }) => id === 'camera')
  assert.equal(core.diagram.width, 72)
  assert.equal(junction.diagram.width, 56)
  assert.equal(endpoint.diagram.width, 36)
  assert.equal(endpoint.layoutParentId, 'jb')
  assert.ok(endpoint.diagram.y > junction.diagram.y)
  assert.deepEqual(layout.nodes.map(({ id }) => id).sort(), model.nodes.map(({ id }) => id).sort())
})

test('semantic zoom uses the specified thresholds and export always includes the full legend', () => {
  assert.equal(getTopologyLabelVisibility({ zoom: .64 }), 'core-peer')
  assert.equal(getTopologyLabelVisibility({ zoom: .65 }), 'detail')
  assert.equal(getTopologyLabelVisibility({ zoom: .94 }), 'detail')
  assert.equal(getTopologyLabelVisibility({ zoom: .95 }), 'all')
  assert.equal(getTopologyLabelVisibility({ zoom: .2, renderMode: 'export' }), 'all')

  const { model, layout } = fixture()
  const exportSvg = renderTopologyDiagramSvg({
    model,
    layout,
    renderMode: 'export',
    semanticLevel: 'focus',
  })
  assert.match(exportSvg, /class="topology-legend"/)
  assert.match(exportSvg, /Backbone core\/JB/)
  assert.match(exportSvg, /<text class="topology-node-name"[^>]*>CAM-01<\/text>/)
})

test('mounting presentation renders a permanent pole box without a network edge', () => {
  const { model, layout } = fixture()
  const withMounting = buildTopologyDiagramModel({
    assets: [...model.nodes, {
      id: 'pole', name: 'T-018', type: 'Pole', topologyRole: 'physical_mount', locationGroupKey: 'area-a',
    }],
    graph: { nodes: model.nodes, edges: model.edges },
    roots: ['core'],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
    mountingRelations: [{ id: 'mount-camera', relationType: 'mounted_on', sourceAssetId: 'camera', targetAssetId: 'pole' }],
  })
  const withMountingLayout = calculateTopologyDiagramLayout(withMounting)
  const svg = renderTopologyDiagramSvg({
    model: withMounting,
    layout: withMountingLayout,
    selectedAssetId: 'camera',
  })
  assert.match(svg, /<rect class="topology-mounting-bubble"/)
  assert.match(svg, /T-018/)
  assert.doesNotMatch(svg, /<ellipse class="topology-mounting-bubble"/)
  assert.doesNotMatch(svg, /data-node-id="pole"/)
  assert.doesNotMatch(svg, /data-edge-id="mount-camera"/)
  assert.ok(layout.nodes.length > 0)
})
