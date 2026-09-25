import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramModel } from '../src/domain/topology-diagram-model.js'
import { calculateTopologyDiagramLayout } from '../src/pages/topology/topology-diagram-layout.js'
import {
  getTopologySelectionRoute,
  renderTopologyDiagramSvg,
} from '../src/pages/topology/topology-diagram-svg.js'

function renderFixture(options = {}) {
  const assets = [
    { id: 'core', name: 'Core', type: 'Router', topologyRole: 'core', networkFamily: 'infrastructure', locationGroupKey: 'area-a' },
    { id: 'camera', name: 'Camera', type: 'CCTV', topologyRole: 'endpoint', networkFamily: 'cctv', locationGroupKey: 'area-a' },
    { id: 'other', name: 'Other', type: 'Printer', topologyRole: 'endpoint', networkFamily: 'peripheral', locationGroupKey: 'area-a' },
    { id: 'pole', name: 'T-018', type: 'Tiang CCTV', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
    { id: 'empty-pole', name: 'T-021', type: 'Tiang CCTV', topologyRole: 'physical_mount', locationGroupKey: 'area-a' },
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
  const { model, layout, svg } = renderFixture()
  assert.match(svg, /class="topology-diagram-svg"/)
  assert.match(svg, /Diagram Topologi/)
  assert.match(svg, /data-edge-id="core-camera"/)
  assert.doesNotMatch(svg, /data-candidate-id="candidate-1"/)
  assert.doesNotMatch(svg, /data-unresolved-id="unresolved-1"/)
  assert.match(svg, /#ffffff/)
  assert.match(svg, /geometry line-1/)
  assert.match(svg, /topology-lane-kicker/)
  assert.match(svg, /topology-node-card/)
  assert.match(svg, /data-connection-type="camera-core"[^>]*stroke="#1ba6ad"/)
  assert.doesNotMatch(svg, /class="topology-grid"/)
  assert.match(svg, /topology-mounting-group/)
  assert.match(svg, /topology-mounting-bubble/)
  assert.match(svg, /<rect class="topology-mounting-bubble"/)
  assert.match(svg, /<path class="topology-mounting-header-fill"/)
  assert.match(svg, /--frame-accent:#[0-9a-f]{6}/)
  assert.match(svg, /class="topology-presentation-backbone" data-parent-id="core"/)
  const withoutMountingBoxes = renderTopologyDiagramSvg({
    model,
    layout,
    showMountingPhysical: false,
  })
  assert.doesNotMatch(withoutMountingBoxes, /<g class="topology-mounting-group/)
  const selectedMountingBox = renderTopologyDiagramSvg({
    model,
    layout,
    selectedMountingGroupId: model.mountingGroups[0].id,
  })
  assert.match(selectedMountingBox, /<g class="topology-mounting-group confirmed selected"/)
  assert.match(selectedMountingBox, /class="topology-mounting-selection"/)
  assert.match(svg, /T-018 · 1 aset/)
  assert.match(svg, /topology-mounting-group empty/)
  assert.match(svg, /T-021 · 0 aset · belum ada mounting/)
  assert.doesNotMatch(svg, /data-edge-id="mount-camera"/)
  assert.doesNotMatch(svg, /data-node-id="pole"/)
})

test('SVG exposes editable frame labels and renders a saved custom name', () => {
  const { model, layout } = renderFixture()
  const groupId = model.mountingGroups.find(({ hostId }) => hostId === 'pole').id
  const svg = renderTopologyDiagramSvg({
    model,
    layout,
    mountingLabelById: { [groupId]: 'Gerbang Utama' },
  })

  assert.match(svg, new RegExp(`data-frame-label="${groupId}"`))
  assert.match(svg, /Tiang · Gerbang Utama/)
})

test('SVG uses the preloaded source icon from the KMZ style when available', () => {
  const { model, layout } = renderFixture()
  const iconUrl = '/api/dataset-versions/version-1/source-resources/resource-camera'
  model.nodeById.get('camera').sourceIconUrl = iconUrl
  const svg = renderTopologyDiagramSvg({
    model,
    layout,
    sourceIconDataByUrl: new Map([[iconUrl, 'data:image/png;base64,Y2FtZXJh']]),
  })

  assert.match(svg, /class="topology-source-icon"/)
  assert.match(svg, /data:image\/png;base64,Y2FtZXJh/)
})

test('SVG renders rack backbone gaps separately from confirmed edges', () => {
  const assets = [
    { id: 'rack', name: 'JB Rack Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'area-a' },
    { id: 'rack-jb', name: 'JB-RACK-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'remote-jb', name: 'JB-REMOTE-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'area-a' },
    { id: 'remote-camera', name: 'CAM-REMOTE-01', type: 'CCTV', topologyRole: 'endpoint', locationGroupKey: 'area-a' },
  ]
  const model = buildTopologyDiagramModel({
    assets,
    area: 'area-a',
    roots: ['rack'],
    locationGroups: [{ key: 'area-a', name: 'Area A' }],
    graph: {
      nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'rack-jb', sourceNodeId: 'rack', targetNodeId: 'rack-jb', relationStatus: 'confirmed' },
        { id: 'remote-camera', sourceNodeId: 'remote-jb', targetNodeId: 'remote-camera', relationStatus: 'confirmed' },
      ],
    },
  })
  const layout = calculateTopologyDiagramLayout(model)
  const svg = renderTopologyDiagramSvg({ model, layout, renderMode: 'export', semanticLevel: 'focus' })

  assert.equal(layout.backboneGaps.length, 1)
  assert.equal(layout.backboneGaps[0].routePoints.length, 2)
  assert.equal(layout.backboneGaps[0].routePoints[0].x, layout.backboneGaps[0].routePoints[1].x)
  assert.ok(Math.abs(
    layout.backboneGaps[0].routePoints[1].y - layout.backboneGaps[0].routePoints[0].y,
  ) <= 24, 'gap diagnostic stays local to its island root')
  assert.match(svg, /class="topology-backbone-gap"/)
  assert.match(svg, /class="topology-presentation-backbone" data-parent-id="rack"/)
  assert.doesNotMatch(svg, /GAP KE RACK/)
  assert.doesNotMatch(svg, /data-edge-id="backbone-gap:/)
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

test('camera names remain visible through 50 percent and collapse below that threshold', () => {
  const { model, layout } = renderFixture()
  const far = renderTopologyDiagramSvg({ model, layout, zoom: .49, labelMode: 'auto' })
  const half = renderTopologyDiagramSvg({ model, layout, zoom: .5, labelMode: 'auto' })
  const middle = renderTopologyDiagramSvg({ model, layout, zoom: .85, labelMode: 'auto' })
  const close = renderTopologyDiagramSvg({ model, layout, zoom: 1, labelMode: 'auto' })
  assert.match(far, /data-node-id="camera" data-label-detail="true"/)
  for (const svg of [half, middle, close]) {
    assert.doesNotMatch(svg, /data-node-id="camera" data-label-detail="true"/)
    assert.match(svg, /<text class="topology-node-name"[^>]*>Camera<\/text>/)
  }
  assert.match(far, /data-semantic-level="overview"/)
  assert.match(half, /data-semantic-level="overview"/)
  assert.match(middle, /data-semantic-level="detail"/)
  assert.match(close, /data-semantic-level="focus"/)
  assert.doesNotMatch(half, /topology-label-compensation|topology-node-label-compensation/)
})

test('selecting a junction reveals labels on its descendants below 50 percent', () => {
  const { model, layout } = renderFixture()
  layout.nodes.find((node) => node.id === 'core').diagramClass = 'junction-peer'
  layout.nodes.find((node) => node.id === 'camera').parentId = 'core'
  layout.nodes.find((node) => node.id === 'other').parentId = 'core'
  const svg = renderTopologyDiagramSvg({ model, layout, selectedAssetId: 'core', zoom: .35 })
  assert.match(svg, /data-node-id="camera" data-revealed-by-junction="true"/)
  assert.match(svg, /data-node-id="other" data-revealed-by-junction="true"/)
  assert.doesNotMatch(svg, /data-node-id="camera" data-label-detail="true"/)
  assert.doesNotMatch(svg, /topology-reveal-compensation/)
})

test('DPPU YIA keeps camera labels available on hover and keyboard focus at overview zoom', () => {
  const { model, layout } = renderFixture()
  const svg = renderTopologyDiagramSvg({
    model,
    layout,
    context: { areaKey: 'dppu-yia' },
    zoom: .35,
    labelMode: 'auto',
  })
  assert.match(svg, /data-node-id="camera" data-label-detail="true" tabindex="0"/)
  assert.match(svg, /data-label-detail="true"]:focus .topology-node-name/)
  assert.match(svg, /<text class="topology-node-name" data-label-detail="true"[^>]*>Camera<\/text>/)
})

test('documentation render keeps every endpoint label visible regardless of screen zoom', () => {
  const { model, layout } = renderFixture()
  const documentation = renderTopologyDiagramSvg({
    model,
    layout,
    labelMode: 'all',
    zoom: .35,
    renderMode: 'export',
  })
  assert.match(documentation, /<text class="topology-node-name"[^>]*>Camera<\/text>/)
  assert.doesNotMatch(documentation, /data-node-id="camera" data-label-detail="true"/)
  assert.doesNotMatch(documentation, /topology-label-compensation/)
  assert.match(documentation, /topology-mounting-header/)
})

test('SVG preserves selection without dropping graph nodes', () => {
  const { model, layout } = renderFixture()
  const selectedSvg = renderTopologyDiagramSvg({
    model,
    layout,
    selectedAssetId: 'camera',
  })
  assert.deepEqual(getTopologySelectionRoute(layout, 'camera'), {
    nodeIds: ['core', 'camera'],
    edgeIds: ['core-camera'],
  })
  assert.match(selectedSvg, /class="topology-edge[^"]*selected-path/)
  assert.match(selectedSvg, /topology-node dimmed/)
  assert.match(selectedSvg, /topology-edge[^>]*dimmed|class="topology-edge[^\"]*dimmed/)
  const svg = renderTopologyDiagramSvg({
    model,
    layout,
    selectedAssetId: 'camera',
    selectedEdgeId: 'core-camera',
  })
  assert.match(svg, /topology-node selected/)
  assert.match(svg, /class="topology-node-selection-glow"/)
  assert.match(svg, /topology-edge.*selected/)
  assert.match(svg, /data-node-id="core"/)
  assert.match(svg, /data-node-id="camera"/)
})
