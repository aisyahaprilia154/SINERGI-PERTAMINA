import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTopologyRootAssignments,
  buildTopologyPresentation,
  inheritTopologyRootOverrides,
  overlayTopologyPresentation,
} from '../src/topology/topology-root-assignments.js'

test('strict resolver supports three Lomanis roots without promoting server text in a JB name', () => {
  const bundle = fixtureBundle()
  const automatic = applyTopologyRootAssignments(bundle)
  assert.deepEqual(automatic.rootAssignments.map(({ sourceName }) => sourceName), [
    'Server Selatan',
  ])

  const resolved = applyTopologyRootAssignments(bundle, [{
    assetId: 'root-utara', action: 'promote', zoneKey: 'utara', aliases: ['SR-Utara'],
  }, {
    assetId: 'root-cr', action: 'promote', zoneKey: 'cr', aliases: ['CR'],
  }])
  assert.deepEqual(resolved.rootAssignments.map(({ zoneKey }) => zoneKey), [
    'cr', 'selatan', 'utara',
  ])
  assert.equal(resolved.classifiedNodes.find(({ assetId }) => (
    assetId === 'root-utara'
  )).jbProfileId, 'builtin:server_rack')
  const reset = applyTopologyRootAssignments(resolved, [])
  assert.deepEqual(reset.rootAssignments.map(({ sourceName }) => sourceName), [
    'Server Selatan',
  ])
})

test('presentation gaps stay separate from confirmed graph and orphan CCTV is unmapped', () => {
  const bundle = applyTopologyRootAssignments(fixtureBundle(), [{
    assetId: 'root-utara', action: 'promote', zoneKey: 'utara', aliases: ['SR-Utara'],
  }, {
    assetId: 'root-cr', action: 'promote', zoneKey: 'cr', aliases: ['CR'],
  }])
  const graph = {
    graphRevision: 'topology-graph:test',
    nodes: bundle.classifiedNodes.map((node) => ({ id: node.assetId })),
    edges: [{
      id: 'edge-jb-camera',
      sourceAssetId: 'jb-17',
      targetAssetId: 'camera-connected',
      verificationStatus: 'confirmed',
    }],
  }
  const presentation = buildTopologyPresentation(bundle, graph)

  assert.equal(graph.edges.length, 1)
  assert.equal(presentation.backboneGaps.length, 1)
  assert.equal(presentation.backboneGaps[0].targetAssetId, 'jb-17')
  assert.equal(presentation.backboneGaps[0].verificationStatus, 'unconfirmed')
  assert.deepEqual(presentation.unmappedAssetIds, ['camera-orphan'])
  const projected = overlayTopologyPresentation({
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, topologyRole: 'unknown' })),
  }, presentation)
  assert.equal(
    projected.nodes.find(({ id }) => id === 'root-utara').topologyRole,
    'root',
  )
  assert.equal(
    projected.nodes.find(({ id }) => id === 'root-utara').diagramClass,
    'rack-root',
  )
})

test('root overrides inherit only through stable asset identity', () => {
  const previous = {
    topologyInputBundle: fixtureBundle(),
    topologyRootOverrides: [{
      assetId: 'root-utara', stableAssetId: 'stable-root-utara',
      action: 'promote', zoneKey: 'utara', aliases: ['sr-utara'],
    }, {
      assetId: 'root-cr', stableAssetId: 'stable-missing',
      action: 'promote', zoneKey: 'cr', aliases: ['cr'],
    }],
  }
  const next = fixtureBundle()
  const nextRoot = next.classifiedNodes.find(({ assetId }) => assetId === 'root-utara')
  nextRoot.assetId = 'root-utara-v2'
  nextRoot.canonicalAssetId = 'root-utara-v2'
  const inherited = inheritTopologyRootOverrides(previous, next)

  assert.equal(inherited.overrides.length, 1)
  assert.equal(inherited.overrides[0].assetId, 'root-utara-v2')
  assert.equal(inherited.overrides[0].status, 'inherited')
  assert.equal(inherited.reviewItems.length, 1)
  assert.equal(inherited.reviewItems[0].reasonCode, 'stable_asset_not_found_in_new_version')
})

function fixtureBundle() {
  return {
    datasetVersion: { id: 'dv-roots', sourceChecksum: 'sha256:test' },
    classifiedNodes: [
      fixtureNode('root-selatan', 'stable-root-selatan', 'Server Selatan', 'server_rack', 'root', 'rack-root', [110, -7]),
      fixtureNode('root-utara', 'stable-root-utara', 'JB-FO-Server Utara', 'junction_box', 'junction', 'junction-peer', [110.01, -7]),
      fixtureNode('root-cr', 'stable-root-cr', 'JB-FO-Server CR', 'junction_box', 'junction', 'junction-peer', [110.02, -7]),
      fixtureNode('jb-17', 'stable-jb-17', 'JB-017', 'junction_box', 'junction', 'junction-peer', [110.011, -7]),
      fixtureNode('camera-connected', 'stable-camera-connected', 'C-028', 'cctv_camera', 'endpoint', 'endpoint', [110.012, -7]),
      fixtureNode('camera-orphan', 'stable-camera-orphan', 'C-099', 'cctv_camera', 'endpoint', 'endpoint', [110.03, -7]),
    ],
    classifiedPaths: [],
    geometries: [
      point('g-root-selatan', [110, -7]),
      point('g-root-utara', [110.01, -7]),
      point('g-root-cr', [110.02, -7]),
      point('g-jb-17', [110.011, -7]),
      point('g-camera-connected', [110.012, -7]),
      point('g-camera-orphan', [110.03, -7]),
    ],
  }
}

function fixtureNode(assetId, stableAssetId, sourceName, assetType, topologyRole, diagramClass, coordinate) {
  return {
    assetId,
    canonicalAssetId: assetId,
    stableAssetId,
    sourceName,
    sourceFolderPath: '/RJBT/FT LOMANIS/JUNCTION BOX/Rekomendasi',
    siteId: 'semarang',
    objectRole: 'device_node',
    assetType,
    category: assetType,
    topologyRole,
    diagramClass,
    geometryIds: [`g-${assetId}`],
    coordinate,
  }
}

function point(geometryId, coordinates) {
  return { geometryId, geometryType: 'Point', coordinates, valid: true }
}
