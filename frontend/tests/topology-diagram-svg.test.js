import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramModel } from '../src/domain/topology-diagram-model.js'
import { calculateTopologyDiagramLayout } from '../src/pages/topology/topology-diagram-layout.js'
import { renderTopologyDiagramSvg } from '../src/pages/topology/topology-diagram-svg.js'

function renderFixture(options = {}) {
  const assets = [
    { id: 'core', name: 'Core', type: 'Router', topologyRole: 'core', networkFamily: 'infrastructure', locationGroupKey: 'area-a' },
    { id: 'camera', name: 'Camera', type: 'CCTV', topologyRole: 'endpoint', networkFamily: 'cctv', locationGroupKey: 'area-a' },
    { id: 'other', name: 'Other', type: 'Printer', topologyRole: 'endpoint', networkFamily: 'peripheral', locationGroupKey: 'area-a' },
    { id: 'pole', name: 'T-018', type: 'Tiang CCTV', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    graph: {
      graphRevision: 'svg-revision',
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [{
        id: 'core-camera',
        sourceNodeId: 'core',
        targetNodeId: 'camera',
        relationStatus: 'confirmed',
        networkFamily: 'cctv',
        sourceGeometryId: 'line-1',
        pathAssetId: 'cable-1',
        provenance: 'explicit',
      }],
    },
    roots: ['core'],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
    candidates: [{
      candidateId: 'candidate-1',
      candidateStatus: 'candidate',
      sourcePathAssetId: 'core',
      targetAssetId: 'camera',
      networkFamily: 'cctv',
    }, {
      candidateId: 'candidate-ambiguous',
      candidateStatus: 'ambiguous',
      sourcePathAssetId: 'core',
      targetAssetId: 'camera',
      networkFamily: 'cctv',
    }],
    unresolved: [{
      unresolvedId: 'unresolved-1',
      sourcePathAssetId: 'camera',
      reason: 'endpoint_without_safe_target',
    }],
    mountingRelations: [{
      id: 'mount-camera',
      relationType: 'mounted_on',
      sourceAssetId: 'camera',
      targetAssetId: 'pole',
    }],
    showAdminLayers: options.showAdminLayers ?? false,
  })
  const layout = calculateTopologyDiagramLayout(model)
  return { model, layout, svg: renderTopologyDiagramSvg({ model, layout, ...options }) }
}

test('SVG is a light logical projection and hides admin evidence by default', () => {
  const { svg } = renderFixture()
  assert.match(svg, /class="topology-diagram-svg"/)
  assert.match(svg, /Diagram Topologi/)
  assert.match(svg, /data-edge-id="core-camera"/)
  assert.doesNotMatch(svg, /data-candidate-id="candidate-1"/)
  assert.doesNotMatch(svg, /data-unresolved-id="unresolved-1"/)
  assert.match(svg, /#ffffff/)
  assert.match(svg, /geometry line-1/)
  assert.match(svg, /topology-lane-kicker/)
  assert.match(svg, /topology-node-card/)
  assert.match(svg, /stroke="#64798b"/)
  assert.doesNotMatch(svg, /class="topology-grid"/)
  assert.match(svg, /topology-mounting-group/)
  assert.match(svg, /topology-mounting-bubble/)
  assert.match(svg, /T-018 · 1 aset/)
  assert.doesNotMatch(svg, /data-edge-id="mount-camera"/)
  assert.doesNotMatch(svg, /data-node-id="pole"/)
})

test('SVG renders candidate and unresolved layers only when administrator layer is enabled', () => {
  const { svg } = renderFixture({ showAdminLayers: true })
  assert.match(svg, /data-candidate-id="candidate-1"/)
  assert.match(svg, /data-candidate-id="candidate-ambiguous"/)
  assert.match(svg, /class="topology-edge candidate"/)
  assert.match(svg, /topology-candidate-warning/)
  assert.match(svg, /data-unresolved-id="unresolved-1"/)
  assert.match(svg, /topology-unresolved-marker/)
})

test('SVG overview renders area cards instead of the full node graph', () => {
  const { model } = renderFixture()
  const layout = calculateTopologyDiagramLayout(model, { overview: true })
  const svg = renderTopologyDiagramSvg({ model, layout })
  assert.match(svg, /topology-area-overview-card/)
  assert.match(svg, /data-area-overview="area-a"/)
  assert.doesNotMatch(svg, /data-node-id="core"/)
  assert.doesNotMatch(svg, /data-edge-id="core-camera"/)
})

test('auto label visibility keeps endpoint labels hidden until close zoom', () => {
  const { model, layout } = renderFixture()
  const far = renderTopologyDiagramSvg({ model, layout, zoom: .6, labelMode: 'auto' })
  const close = renderTopologyDiagramSvg({ model, layout, zoom: .8, labelMode: 'auto' })
  assert.doesNotMatch(far, /<text class="topology-node-name"[^>]*>Camera<\/text>/)
  assert.match(close, /<text class="topology-node-name"[^>]*>Camera<\/text>/)
})

test('SVG preserves selection and trace presentation without dropping graph nodes', () => {
  const { model, layout } = renderFixture()
  const selectedSvg = renderTopologyDiagramSvg({
    model,
    layout,
    selectedAssetId: 'camera',
  })
  assert.match(selectedSvg, /topology-node dimmed/)
  assert.match(selectedSvg, /topology-edge[^>]*dimmed|class="topology-edge[^\"]*dimmed/)
  const tracedModel = buildTopologyDiagramModel({
    assets: model.nodes,
    graph: {
      graphRevision: model.graphRevision,
      nodes: model.nodes,
      edges: model.edges,
    },
    roots: ['core'],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
    traceAssetIds: ['core', 'camera'],
    traceEdgeIds: ['core-camera'],
  })
  const svg = renderTopologyDiagramSvg({
    model: tracedModel,
    layout,
    selectedAssetId: 'camera',
    selectedEdgeId: 'core-camera',
  })
  assert.match(svg, /topology-node selected/)
  assert.match(svg, /topology-edge.*trace/)
  assert.match(svg, /topology-edge.*selected/)
  assert.match(svg, /data-node-id="core"/)
  assert.match(svg, /data-node-id="camera"/)
})
