import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adaptActiveAssetDetail,
  adaptActiveDatasetForMap,
} from '../src/adapters/active-dataset-map-adapter.js'

test('active dataset adapter preserves source coordinates and uses explicit relations only', () => {
  const payload = {
    activePointer: {
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      datasetVersionId: 'version-active',
      revision: 'pointer-revision',
      activatedAt: '2026-07-28T09:00:00.000Z',
    },
    datasetVersion: {
      id: 'version-active',
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      versionName: 'Versi Aktif',
      sourceFilename: 'network.kml',
      activatedAt: '2026-07-28T09:00:00.000Z',
    },
    assets: [
      asset('node-a', 'A-001', 'Infrastructure'),
      asset('node-b', 'B-001', 'CCTV'),
      asset('node-near', 'NEAR-001', 'CCTV'),
    ],
    geometries: [
      point('geometry-a', 'node-a', 110.4167, -6.9667),
      point('geometry-b', 'node-b', 110.4171, -6.9663),
      point('geometry-near', 'node-near', 110.4171001, -6.9663001),
    ],
    relations: [{
      id: 'relation-a-b',
      sourceAssetId: 'A-001',
      targetAssetId: 'B-001',
      relationType: 'connected_to',
    }],
  }
  const snapshot = structuredClone(payload)

  const result = adaptActiveDatasetForMap(payload)

  assert.deepEqual(payload, snapshot)
  assert.equal(result.activeContext.datasetVersionId, 'version-active')
  assert.equal(result.activeContext.activePointerRevision, 'pointer-revision')
  assert.deepEqual(result.assets.map(({ id }) => id), ['A-001', 'B-001', 'NEAR-001'])
  assert.ok(result.assets.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
  assert.deepEqual(result.assetById['A-001'].geometry[0].coordinates, [110.4167, -6.9667])

  const renderedEdges = result.networks.flatMap(({ edges }) => edges)
  assert.ok(renderedEdges.some(([source, target]) => source === 'A-001' && target === 'B-001'))
  assert.ok(renderedEdges.every(([source, target]) => (
    source !== 'NEAR-001' && target !== 'NEAR-001'
  )))
})

test('active map layers preserve normalized line and polygon coordinates separately from display space', () => {
  const payload = {
    activePointer: {
      revision: 'revision-layered',
      activatedAt: '2026-07-28T09:00:00.000Z',
    },
    datasetVersion: {
      id: 'version-active',
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      versionName: 'Versi Aktif',
    },
    layers: [
      {
        id: 'layer-fo',
        name: 'FO Backbone',
        sourceFolderPath: '/Fiber Optic/Backbone',
        category: 'Fiber Optic',
        displayOrder: 1,
        defaultVisible: true,
      },
      {
        id: 'layer-empty',
        name: 'Cadangan',
        sourceFolderPath: '/Cadangan',
        category: 'LAN',
        displayOrder: 2,
        defaultVisible: false,
      },
    ],
    assets: [{
      ...asset('node-line', 'FO-001', 'Fiber Optic'),
      layerId: 'layer-fo',
      type: 'Fiber Backbone',
    }],
    geometries: [
      {
        id: 'line-1',
        assetNodeId: 'node-line',
        geometryType: 'line_string',
        coordinates: [[110, -7], [110.1, -7.1], [110.2, -7.2]],
      },
      {
        id: 'polygon-1',
        assetNodeId: 'node-line',
        geometryType: 'polygon',
        coordinates: [[
          [110, -7],
          [110.2, -7],
          [110.2, -7.2],
          [110, -7],
        ]],
      },
    ],
    relations: [],
  }
  const snapshot = structuredClone(payload)

  const result = adaptActiveDatasetForMap(payload)
  const backbone = result.networks.find(({ id }) => id === 'network:fiber-optic')

  assert.deepEqual(payload, snapshot)
  assert.equal(backbone.lineRole, 'fiber-backbone')
  assert.deepEqual(backbone.assetIds, ['FO-001'])
  assert.equal(backbone.nodeCount, 0)
  assert.equal(backbone.lineCount, 1)
  assert.equal(backbone.polygonCount, 1)
  assert.equal(result.networks.some(({ id }) => id === 'layer:layer-empty'), false)
  assert.equal(result.assets.length, 0)
  assert.equal(result.exportAssets.length, 1)
  assert.deepEqual(
    result.geometries.find(({ id }) => id === 'line-1').coordinates,
    [[110, -7], [110.1, -7.1], [110.2, -7.2]],
  )
  assert.ok(result.geometries.find(({ id }) => id === 'line-1').displayCoordinates
    .every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))
  assert.deepEqual(result.counts, {
    networkCount: 1,
    layerCount: 2,
    assetCount: 1,
    assetNodeCount: 0,
    pointCount: 0,
    lineCount: 1,
    polygonCount: 1,
    geometryCount: 2,
    confirmedRelationCount: 0,
    inferredPendingCount: 0,
    unresolvedRelationCount: 2,
    isolatedAssetCount: 0,
    hiddenPlacemarkCount: 0,
  })
})

test('Point becomes one selectable map node', () => {
  const payload = activePayload({
    layers: [layer('layer-cctv', 'CCTV', 'CCTV')],
    assets: [asset('node-camera', 'CAM-01', 'CCTV')],
    geometries: [point('point-camera', 'node-camera', 110.4, -7)],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.assets.length, 1)
  assert.equal(result.assets[0].assetId, 'CAM-01')
  assert.deepEqual(result.assets[0].coordinate, [110.4, -7])
  assert.equal(result.geometries[0].geometryType, 'point')
  assert.equal(result.counts.assetNodeCount, 1)
})

test('LineString remains geometry and never becomes a map node', () => {
  const payload = activePayload({
    layers: [layer('layer-fo', 'Fiber Optic', 'Fiber Optic')],
    assets: [{
      ...asset('node-cable', 'FO-CABLE-01', 'Fiber Optic'),
      layerId: 'layer-fo',
      type: 'Fiber optic cable',
    }],
    geometries: [{
      id: 'line-cable',
      assetNodeId: 'node-cable',
      geometryType: 'line_string',
      coordinates: [[110, -7], [110.1, -7.1]],
    }],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.assets.length, 0)
  assert.equal(result.exportAssets.length, 1)
  assert.equal(result.geometries.length, 1)
  assert.equal(result.networks[0].nodeIds.length, 0)
  assert.deepEqual(result.networks[0].assetIds, ['FO-CABLE-01'])
  assert.equal(result.counts.lineCount, 1)
})

test('active adapter exposes inferred endpoints as review candidates, not User edges', () => {
  const payload = activePayload({
    layers: [layer('layer-lan', 'LAN', 'LAN')],
    assets: [{
      ...asset('node-a', 'SW-A', 'LAN'),
      layerId: 'layer-lan',
      type: 'Switch',
    }, {
      ...asset('node-b', 'AP-B', 'LAN'),
      layerId: 'layer-lan',
      type: 'Access Point',
    }, {
      ...asset('node-line', 'LAN-01', 'LAN'),
      layerId: 'layer-lan',
      type: 'LAN cable',
    }],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      {
        id: 'line-lan',
        assetNodeId: 'node-line',
        geometryType: 'line_string',
        coordinates: [[110, -7], [110.001, -7]],
      },
    ],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.topologyGraph.edges.length, 0)
  assert.equal(result.topologyGraph.candidateEdges.length, 1)
  assert.equal(result.topologyGraph.candidateEdges[0].relationSource, 'inferred_endpoint')
  assert.deepEqual(result.networks[0].edges, [])
  assert.equal(result.assets.find(({ id }) => id === 'SW-A').relationCount, 0)
  assert.equal(result.relationReadiness.scope.canCreateDiagram, false)
})

test('path network includes compatible endpoint nodes from another inventory category', () => {
  const payload = activePayload({
    layers: [
      layer('layer-infra', 'Switch', 'Infrastructure'),
      layer('layer-fo', 'Fiber Optic', 'Fiber Optic'),
    ],
    assets: [{
      ...asset('node-a', 'SW-A', 'Infrastructure'),
      layerId: 'layer-infra',
      type: 'Switch',
    }, {
      ...asset('node-b', 'SW-B', 'Infrastructure'),
      layerId: 'layer-infra',
      type: 'Switch',
    }, {
      ...asset('node-line', 'FO-01', 'Fiber Optic'),
      layerId: 'layer-fo',
      type: 'Fiber Optic line',
    }],
    geometries: [
      point('point-a', 'node-a', 110, -7),
      point('point-b', 'node-b', 110.001, -7),
      {
        id: 'line-fo',
        assetNodeId: 'node-line',
        geometryType: 'line_string',
        coordinates: [[110, -7], [110.001, -7]],
      },
    ],
  })

  const result = adaptActiveDatasetForMap(payload)
  const fiberNetwork = result.networks.find(({ id }) => id === 'network:fiber-optic')

  assert.deepEqual(fiberNetwork.nodeIds.sort(), ['SW-A', 'SW-B'])
  assert.ok(result.assets.find(({ id }) => id === 'SW-A')
    .networkIds.includes('network:fiber-optic'))
  assert.equal(fiberNetwork.relations.length, 0)
  assert.equal(fiberNetwork.relationReadiness.pendingEdgeCount, 1)
  assert.equal(fiberNetwork.relationReadiness.geographicLineCount, 1)
})

test('Polygon remains geometry and never becomes a map node', () => {
  const payload = activePayload({
    layers: [layer('layer-area', 'Area CCTV', 'CCTV')],
    assets: [{
      ...asset('node-area', 'AREA-01', 'CCTV'),
      layerId: 'layer-area',
    }],
    geometries: [{
      id: 'polygon-area',
      assetNodeId: 'node-area',
      geometryType: 'polygon',
      coordinates: [[
        [110, -7],
        [110.1, -7],
        [110, -7.1],
        [110, -7],
      ]],
    }],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.assets.length, 0)
  assert.equal(result.geometries[0].geometryType, 'polygon')
  assert.equal(result.counts.polygonCount, 1)
})

test('MultiGeometry is split into parts without duplicating its owner asset', () => {
  const payload = activePayload({
    layers: [layer('layer-mixed', 'CCTV', 'CCTV')],
    assets: [asset('node-mixed', 'MIXED-01', 'CCTV')],
    geometries: [{
      id: 'multi-1',
      assetNodeId: 'node-mixed',
      geometryType: 'multi_geometry',
      coordinates: [{
        geometryType: 'point',
        coordinates: [110, -7],
      }, {
        geometryType: 'line_string',
        coordinates: [[110, -7], [110.1, -7.1]],
      }],
    }],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.exportAssets.length, 1)
  assert.equal(result.assets.length, 1)
  assert.equal(result.geometries.length, 2)
  assert.deepEqual(
    result.geometries.map(({ id }) => id),
    ['multi-1:part:1', 'multi-1:part:2'],
  )
  assert.ok(result.geometries.every(({ assetId }) => assetId === 'MIXED-01'))
  assert.equal(result.counts.assetCount, 1)
})

test('empty layers are retained for source context but never become active networks', () => {
  const result = adaptActiveDatasetForMap(activePayload({
    layers: [
      layer('layer-parent', 'Root', 'unmapped'),
      {
        ...layer('layer-empty', 'Empty', 'unmapped'),
        parentLayerId: 'layer-parent',
      },
    ],
  }))

  assert.equal(result.layers.length, 2)
  assert.equal(result.networks.length, 0)
  assert.equal(result.counts.networkCount, 0)
  assert.equal(result.counts.layerCount, 2)
})

test('nested source layers group into one semantic network instead of one network per folder', () => {
  const payload = activePayload({
    layers: [
      layer('layer-root', 'Site', 'unmapped'),
      {
        ...layer('layer-cctv', 'CCTV', 'CCTV'),
        parentLayerId: 'layer-root',
      },
      {
        ...layer('layer-camera', 'Camera Fix Dome', 'CCTV'),
        parentLayerId: 'layer-cctv',
      },
    ],
    assets: [{
      ...asset('node-camera', 'CAM-01', 'CCTV'),
      layerId: 'layer-camera',
      type: 'Camera Fix Dome',
    }],
    geometries: [point('point-camera', 'node-camera', 110, -7)],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.layers.length, 3)
  assert.equal(result.networks.length, 1)
  assert.equal(result.networks[0].id, 'network:cctv')
  assert.equal(result.assets[0].type, 'CCTV')
})

test('unmapped objects are preserved in a dedicated semantic network without warning status', () => {
  const payload = activePayload({
    layers: [layer('layer-other', 'Other', 'unmapped')],
    assets: [{
      ...asset('node-other', 'OTHER-01', 'unmapped'),
      layerId: 'layer-other',
      type: 'Sensor khusus',
    }],
    geometries: [point('point-other', 'node-other', 110, -7)],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.networks[0].id, 'network:unmapped')
  assert.equal(result.networks[0].name, 'Belum terpetakan')
  assert.equal(result.assets[0].status, 'Status tidak tersedia')
  assert.equal(result.assets[0].sourceStatus, 'visible')
})

test('hidden Placemark is preserved for export but excluded from map nodes and networks', () => {
  const payload = activePayload({
    layers: [layer('layer-cctv', 'CCTV', 'CCTV')],
    assets: [{
      ...asset('node-hidden', 'CAM-HIDDEN', 'CCTV'),
      properties: { visibility: false },
    }],
    geometries: [point('point-hidden', 'node-hidden', 110, -7)],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.exportAssets.length, 1)
  assert.equal(result.exportAssets[0].sourceStatus, 'hidden')
  assert.equal(result.assets.length, 0)
  assert.equal(result.geometries.length, 0)
  assert.equal(result.networks.length, 0)
  assert.equal(result.counts.hiddenPlacemarkCount, 1)
})

test('hidden parent layer makes descendant Placemarks hidden in existing active versions', () => {
  const payload = activePayload({
    layers: [{
      ...layer('layer-hidden-parent', 'Hidden parent', 'CCTV'),
      defaultVisible: false,
    }, {
      ...layer('layer-visible-child', 'Visible child', 'CCTV'),
      parentLayerId: 'layer-hidden-parent',
      defaultVisible: true,
    }],
    assets: [{
      ...asset('node-child', 'CAM-CHILD', 'CCTV'),
      layerId: 'layer-visible-child',
    }],
    geometries: [point('point-child', 'node-child', 110, -7)],
  })

  const result = adaptActiveDatasetForMap(payload)

  assert.equal(result.exportAssets[0].sourceStatus, 'hidden')
  assert.equal(result.assets.length, 0)
  assert.equal(result.geometries.length, 0)
  assert.equal(result.counts.hiddenPlacemarkCount, 1)
})

test('asset detail adapter adds metadata only after the detail request', () => {
  const mapAsset = {
    id: 'SW-01',
    name: 'Switch',
    type: 'Access switch',
    status: 'Status tidak tersedia',
    location: 'Semarang',
  }
  const result = adaptActiveAssetDetail({
    asset: {
      assetId: 'SW-01',
      name: 'Switch Core',
      type: 'Core Switch',
      category: 'Infrastructure',
      location: 'Ruang server',
      properties: {
        status: 'Online',
        ip_address: '10.20.1.2',
        owner: 'IT',
      },
    },
  }, mapAsset)

  assert.equal(result.name, 'Switch Core')
  assert.equal(result.status, 'Online')
  assert.equal(result.ip, '10.20.1.2')
  assert.equal(result.owner, 'IT')
  assert.equal(Object.hasOwn(mapAsset, 'properties'), false)
})

function asset(id, assetId, category) {
  return {
    id,
    assetId,
    name: assetId,
    type: category === 'CCTV' ? 'CCTV' : 'Switch',
    category,
    location: 'Semarang',
    layerId: 'layer-network',
    properties: {},
  }
}

function point(id, assetNodeId, longitude, latitude) {
  return {
    id,
    assetNodeId,
    geometryType: 'point',
    coordinates: [longitude, latitude],
  }
}

function activePayload({
  layers = [],
  assets = [],
  geometries = [],
  relations = [],
} = {}) {
  return {
    activePointer: {
      revision: 'revision-test',
      activatedAt: '2026-07-28T09:00:00.000Z',
    },
    datasetVersion: {
      id: 'version-active',
      datasetId: 'dataset-semarang',
      branchId: 'semarang',
      versionName: 'Versi Aktif',
    },
    layers,
    assets,
    geometries,
    relations,
  }
}

function layer(id, name, category) {
  return {
    id,
    name,
    sourceFolderPath: `/${name}`,
    category,
    displayOrder: 0,
    defaultVisible: true,
  }
}
