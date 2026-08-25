import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTopologyDiagramModel,
  getTopologyDiagramSearchResults,
  isConfirmedTopologyEdge,
} from '../src/domain/topology-diagram-model.js'

const context = {
  branchId: 'branch-a',
  datasetVersionId: 'version-a',
}

const assets = [
  {
    id: 'core-a',
    name: 'CORE-A',
    type: 'Core Router',
    topologyRole: 'core',
    networkFamily: 'infrastructure',
    locationGroupKey: 'north',
    hostname: 'core-a.local',
    ...context,
  },
  {
    id: 'dist-a',
    name: 'DIST-A',
    type: 'Distribution Switch',
    topologyRole: 'distribution',
    networkFamily: 'infrastructure',
    locationGroupKey: 'north',
    ...context,
  },
  {
    id: 'junction-a',
    name: 'JB-A',
    type: 'Junction Box',
    topologyRole: 'junction',
    networkFamily: 'cctv',
    locationGroupKey: 'north',
    ...context,
  },
  {
    id: 'camera-a',
    name: 'CAM-A',
    type: 'CCTV Camera',
    topologyRole: 'endpoint',
    networkFamily: 'cctv',
    locationGroupKey: 'north',
    ...context,
  },
  {
    id: 'isolated-a',
    name: 'Printer A',
    type: 'Printer',
    topologyRole: 'endpoint',
    networkFamily: 'peripheral',
    locationGroupKey: 'north',
    ...context,
  },
  {
    id: 'isolated-b',
    name: 'Printer B',
    type: 'Printer',
    topologyRole: 'endpoint',
    networkFamily: 'peripheral',
    locationGroupKey: 'south',
    ...context,
  },
  {
    id: 'pole-a',
    name: 'T-018',
    type: 'Tiang CCTV',
    topologyRole: 'physical-mount',
    locationGroupKey: 'north',
    ...context,
  },
]

const graph = {
  graphRevision: 'graph-a',
  nodes: assets.map(({ id, topologyRole }) => ({ id, topologyRole })),
  edges: [
    {
      id: 'edge-core-dist',
      sourceNodeId: 'core-a',
      targetNodeId: 'dist-a',
      verificationStatus: 'confirmed',
      networkFamily: 'infrastructure',
      pathAssetIds: ['cable-a'],
      sourceGeometryIds: ['line-a'],
      lengthMeters: 12.5,
      provenance: 'explicit relation',
    },
    {
      id: 'edge-dist-junction',
      sourceNodeId: 'dist-a',
      targetNodeId: 'junction-a',
      relationStatus: 'confirmed',
      networkFamily: 'infrastructure',
    },
    {
      id: 'edge-junction-camera',
      sourceNodeId: 'junction-a',
      targetNodeId: 'camera-a',
      relationStatus: 'confirmed',
      networkFamily: 'cctv',
    },
    {
      id: 'pending-edge',
      sourceNodeId: 'camera-a',
      targetNodeId: 'isolated-a',
      candidateStatus: 'candidate',
      networkFamily: 'cctv',
    },
  ],
}

const locationGroups = [
  { key: 'north', name: 'Area Utara' },
  { key: 'south', name: 'Area Selatan' },
]

test('confirmed model scopes branch/version, keeps isolated assets, and uses verified roots', () => {
  const model = buildTopologyDiagramModel({
    assets,
    graph,
    locationGroups,
    roots: [{ assetId: 'core-a', topologyRole: 'core' }],
    branchId: context.branchId,
    datasetVersionId: context.datasetVersionId,
  })

  assert.equal(model.status, 'ready')
  assert.equal(model.nodes.length, 6)
  assert.equal(model.edges.length, 3)
  assert.equal(model.summary.connectedAssetCount, 4)
  assert.equal(model.summary.isolatedAssetCount, 2)
  assert.equal(model.summary.confirmedEdgeCount, 3)
  assert.equal(model.components.length, 1)
  assert.equal(model.components[0].rootId, 'core-a')
  assert.equal(model.components[0].rootVerified, true)
  assert.equal(model.nodeById.get('core-a').depth, 0)
  assert.equal(model.nodeById.get('camera-a').depth, 3)
  assert.deepEqual(model.areas.map(({ key }) => key), ['north', 'south'])
  assert.deepEqual(model.areas.find(({ key }) => key === 'north').isolatedNodeIds, ['isolated-a'])
  assert.deepEqual(model.areas.find(({ key }) => key === 'south').isolatedNodeIds, ['isolated-b'])
  assert.deepEqual(model.edgeById.get('edge-core-dist').pathAssetIds, ['cable-a'])
})

test('area diagram exposes expected rack backbone gaps without adding operational edges', () => {
  const gapAssets = [
    { id: 'rack', name: 'JB Rack Server', type: 'Server Rack', topologyRole: 'core', locationGroupKey: 'north' },
    { id: 'rack-jb', name: 'JB-RACK-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'north' },
    { id: 'remote-jb', name: 'JB-REMOTE-01', type: 'Junction Box', topologyRole: 'junction', locationGroupKey: 'north' },
    { id: 'remote-camera', name: 'CAM-REMOTE-01', type: 'CCTV Camera', topologyRole: 'endpoint', locationGroupKey: 'north' },
  ]
  const model = buildTopologyDiagramModel({
    assets: gapAssets,
    graph: {
      graphRevision: 'gap-revision',
      nodes: gapAssets.map(({ id, topologyRole }) => ({ id, topologyRole })),
      edges: [
        { id: 'rack-jb-edge', sourceNodeId: 'rack', targetNodeId: 'rack-jb', relationStatus: 'confirmed' },
        { id: 'remote-edge', sourceNodeId: 'remote-jb', targetNodeId: 'remote-camera', relationStatus: 'confirmed' },
      ],
    },
    area: 'north',
    locationGroups: [{ key: 'north', name: 'Area Utara' }],
  })

  assert.equal(model.summary.backboneGapCount, 1)
  assert.deepEqual(model.backboneGaps.map(({ sourceId, targetId }) => ({ sourceId, targetId })), [
    { sourceId: 'rack', targetId: 'remote-jb' },
  ])
  assert.equal(model.edges.length, 2)
  assert.equal(model.topologyLinkById.has(model.backboneGaps[0].id), false)
})

test('candidate, ambiguous, and unresolved layers stay outside operational graph', () => {
  const candidates = [
    {
      candidateId: 'candidate-visible',
      candidateStatus: 'candidate',
      sourcePathAssetId: 'junction-a',
      targetAssetId: 'isolated-a',
      networkFamily: 'cctv',
      branchId: context.branchId,
      datasetVersionId: context.datasetVersionId,
    },
    {
      candidateId: 'candidate-wrong-branch',
      candidateStatus: 'ambiguous',
      sourcePathAssetId: 'junction-a',
      targetAssetId: 'isolated-a',
      branchId: 'other-branch',
    },
  ]
  const unresolved = [{
    sourcePathAssetId: 'camera-a',
    endpointRole: 'target',
    reason: 'endpoint_without_safe_target',
    branchId: context.branchId,
    datasetVersionId: context.datasetVersionId,
  }]

  const hidden = buildTopologyDiagramModel({
    assets,
    graph,
    candidates,
    unresolved,
    locationGroups,
    roots: ['core-a'],
    ...context,
  })
  assert.equal(hidden.candidates.length, 0)
  assert.equal(hidden.allCandidates.length, 1)
  assert.equal(hidden.unresolved.length, 0)
  assert.equal(hidden.allUnresolved.length, 1)
  assert.equal(hidden.allUnresolved[0].areaKey, 'north')
  assert.equal(hidden.edges.some(({ id }) => id === 'pending-edge'), false)

  const admin = buildTopologyDiagramModel({
    assets,
    graph,
    candidates,
    unresolved,
    locationGroups,
    roots: ['core-a'],
    showAdminLayers: true,
    ...context,
  })
  assert.deepEqual(admin.candidates.map(({ candidateId }) => candidateId), ['candidate-visible'])
  assert.equal(admin.unresolved.length, 1)
})

test('area and network-family filters preserve graph and only dim context', () => {
  const model = buildTopologyDiagramModel({
    assets,
    graph,
    locationGroups,
    roots: ['core-a'],
    area: 'north',
    selectedFamilies: new Set(['cctv']),
    search: 'CAM-A',
    ...context,
  })

  assert.equal(model.nodes.length, 5)
  assert.equal(model.edges.length, 3)
  assert.equal(model.nodeById.get('camera-a').dimmed, false)
  assert.equal(model.nodeById.get('core-a').dimmed, true)
  assert.equal(model.edgeById.get('edge-junction-camera').dimmed, false)
  assert.equal(model.edgeById.get('edge-core-dist').dimmed, true)
  assert.equal(model.nodeById.get('camera-a').matched, true)
  assert.equal(model.nodeById.get('core-a').matched, false)
})

test('selected area does not repeat branch-level unresolved evidence', () => {
  const model = buildTopologyDiagramModel({
    assets,
    graph,
    locationGroups,
    roots: ['core-a'],
    area: 'north',
    showAdminLayers: true,
    unresolved: [{
      unresolvedId: 'unresolved-without-area',
      sourcePathAssetId: null,
      reason: 'endpoint_without_safe_target',
      branchId: context.branchId,
      datasetVersionId: context.datasetVersionId,
    }],
    ...context,
  })

  assert.equal(model.unresolved.length, 0)
  assert.equal(model.areas.some(({ key }) => key === 'lainnya'), false)
})

test('search covers hostname and edge provenance', () => {
  const model = buildTopologyDiagramModel({
    assets,
    graph,
    locationGroups,
    roots: ['core-a'],
    ...context,
  })
  assert.equal(getTopologyDiagramSearchResults(model, 'core-a.local')[0].id, 'core-a')
  assert.equal(getTopologyDiagramSearchResults(model, 'line-a')[0].id, 'edge-core-dist')
})

test('search results expose translated type, area, and connection status', () => {
  const model = buildTopologyDiagramModel({
    assets,
    graph,
    locationGroups,
    roots: ['core-a'],
    ...context,
  })
  const assetResult = getTopologyDiagramSearchResults(model, 'CAM-A')[0]
  const edgeResult = getTopologyDiagramSearchResults(model, 'line-a')[0]

  assert.equal(assetResult.typeLabel, 'Kamera CCTV')
  assert.equal(assetResult.area, 'Area Utara')
  assert.equal(assetResult.statusLabel, 'Terkonfirmasi')
  assert.equal(edgeResult.typeLabel, 'Relasi terkonfirmasi')
  assert.equal(edgeResult.statusLabel, 'Terkonfirmasi')
})

test('physical mounting stays a separate group and never becomes a network edge', () => {
  const emptyPole = {
    id: 'pole-empty',
    name: 'T-021',
    type: 'Tiang CCTV',
    topologyRole: 'physical-mount',
    locationGroupKey: 'north',
    ...context,
  }
  const model = buildTopologyDiagramModel({
    assets: [...assets, emptyPole],
    graph,
    locationGroups,
    roots: ['core-a'],
    mountingRelations: [{
      id: 'mount-camera',
      relationType: 'mounted_on',
      sourceAssetId: 'camera-a',
      targetAssetId: 'pole-a',
    }],
    ...context,
  })

  assert.equal(model.edges.some(({ id }) => id === 'mount-camera'), false)
  assert.deepEqual(model.mountingGroups.map(({ hostId, childIds }) => ({ hostId, childIds })), [{
    hostId: 'pole-a',
    childIds: ['camera-a'],
  }, {
    hostId: 'pole-empty',
    childIds: [],
  }])
  assert.equal(model.nodes.some(({ id }) => id === 'pole-a'), false)
  assert.equal(model.nodes.some(({ id }) => id === 'pole-empty'), false)
  assert.equal(model.summary.physicalMountCount, 2)
  assert.equal(model.summary.emptyPhysicalMountCount, 1)
})

test('diagram classes separate JB peer, JB extended, rack root, endpoint, and physical mount', () => {
  const values = [
    ['Server Rack', 'server', 'rack-root'],
    ['JB Rack Server', 'junction', 'rack-root'],
    ['JB-01', 'junction', 'junction-peer'],
    ['JB Extended 01', 'junction_extended', 'junction-extended'],
    ['CCTV Gate', 'endpoint', 'endpoint'],
    ['T-018', 'physical_mount', 'physical-mount'],
  ]
  values.forEach(([name, topologyRole, expected]) => {
    const scoped = buildTopologyDiagramModel({
      assets: [{ id: name, name, type: name, topologyRole, locationGroupKey: 'north' }],
      graph: { nodes: [{ id: name, topologyRole }], edges: [] },
      locationGroups: [{ key: 'north', name: 'Area Utara' }],
    })
    if (expected === 'physical-mount') assert.equal(scoped.nodes.length, 0)
    else assert.equal(scoped.nodes[0].diagramClass, expected)
  })
})

test('canonical diagram class wins over display-name heuristics', () => {
  const model = buildTopologyDiagramModel({
    assets: [{
      id: 'canonical-extended',
      name: 'JB-09',
      type: 'Junction Box',
      diagramClass: 'junction-extended',
      locationGroupKey: 'north',
    }, {
      id: 'canonical-pole',
      name: 'Mount-09',
      type: 'Unknown',
      canonicalAssetType: 'pole',
      locationGroupKey: 'north',
    }, {
      id: 'nested-canonical-pole',
      name: 'T-019',
      type: 'Rekomendasi',
      properties: {
        classification: {
          assetType: 'tiang',
          canonicalAssetType: 'pole',
          category: 'supporting_infrastructure',
        },
      },
      locationGroupKey: 'north',
    }],
    graph: {
      nodes: [{ id: 'canonical-extended', diagramClass: 'junction-extended' }],
      edges: [],
    },
    locationGroups,
  })
  assert.equal(model.nodeById.get('canonical-extended').diagramClass, 'junction-extended')
  assert.equal(model.nodes.some(({ id }) => id === 'canonical-pole'), false)
  assert.equal(model.nodes.some(({ id }) => id === 'nested-canonical-pole'), false)
  assert.equal(model.summary.physicalMountCount, 2)
})

test('cross-area confirmed edges become explicit continuation metadata', () => {
  const scoped = buildTopologyDiagramModel({
    assets: [{
      id: 'north-root',
      name: 'North Core',
      type: 'Router',
      diagramClass: 'rack-root',
      locationGroupKey: 'north',
      branchId: context.branchId,
      datasetVersionId: context.datasetVersionId,
    }, {
      id: 'south-root',
      name: 'South Core',
      type: 'Router',
      diagramClass: 'rack-root',
      locationGroupKey: 'south',
      branchId: context.branchId,
      datasetVersionId: context.datasetVersionId,
    }],
    graph: {
      graphRevision: 'cross-area',
      nodes: [{ id: 'north-root' }, { id: 'south-root' }],
      edges: [{
        id: 'north-south',
        sourceNodeId: 'north-root',
        targetNodeId: 'south-root',
        relationStatus: 'confirmed',
      }],
    },
    locationGroups,
    area: 'north',
    ...context,
  })
  assert.equal(scoped.edges.length, 0)
  assert.equal(scoped.crossAreaEdges.length, 1)
  assert.equal(scoped.crossAreaEdges[0].insideNodeId, 'north-root')
  assert.equal(scoped.summary.crossAreaEdgeCount, 1)
  assert.equal(scoped.areas.find(({ key }) => key === 'north').crossAreaEdgeCount, 1)
})

test('area overview retains cross-area counts without materializing the full graph', () => {
  const overview = buildTopologyDiagramModel({
    assets: [{
      id: 'north-root',
      name: 'North Core',
      type: 'Router',
      diagramClass: 'rack-root',
      locationGroupKey: 'north',
      ...context,
    }, {
      id: 'south-root',
      name: 'South Core',
      type: 'Router',
      diagramClass: 'rack-root',
      locationGroupKey: 'south',
      ...context,
    }],
    graph: {
      nodes: [{ id: 'north-root' }, { id: 'south-root' }],
      edges: [{
        id: 'north-south',
        sourceNodeId: 'north-root',
        targetNodeId: 'south-root',
        relationStatus: 'confirmed',
      }],
    },
    locationGroups,
    ...context,
  })
  assert.equal(overview.crossAreaEdges.length, 1)
  assert.equal(overview.summary.crossAreaEdgeCount, 1)
  assert.deepEqual(overview.areas.map(({ crossAreaEdgeCount }) => crossAreaEdgeCount), [1, 1])
  assert.equal(overview.crossAreaEdges[0].insideNodeId, null)
})

test('edge verification predicate rejects every non-confirmed status', () => {
  assert.equal(isConfirmedTopologyEdge({ verificationStatus: 'confirmed' }), true)
  assert.equal(isConfirmedTopologyEdge({ relationStatus: 'inferred_pending' }), false)
  assert.equal(isConfirmedTopologyEdge({ candidateStatus: 'ambiguous' }), false)
  assert.equal(isConfirmedTopologyEdge({}), true)
})
