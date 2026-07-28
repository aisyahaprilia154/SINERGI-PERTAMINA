import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptNetworkMapData } from '../src/adapters/network-map-adapter.js'
import {
  isAssetNetwork,
  isAssetNode,
  isAssetRelation,
  isMapContext,
  validateNetworkMapData,
} from '../src/domain/network-map-contract.js'
import {
  activeContext,
  assets as currentAssets,
  networks as currentNetworks,
} from '../src/data/demo-network-data.js'

const context = {
  branchId: 'semarang',
  datasetVersionId: 'dataset-v12',
  datasetVersionName: 'Versi 12',
  selectedNetworkIds: ['network-fo'],
}

test('adapter preserves geographic coordinates and does not mutate parser output', () => {
  const parserOutput = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'asset-a',
        geometry: { type: 'Point', coordinates: [110.4167, -6.9667, 12] },
        properties: {
          assetId: 'A-001',
          name: 'OTB-01',
          category: 'fiber-optic',
          type: 'OTB',
          layerId: 'layer-fo',
        },
      },
      {
        type: 'Feature',
        id: 'asset-b',
        geometry: { type: 'Point', coordinates: [110.4171, -6.9663, 12] },
        properties: {
          assetId: 'A-002',
          name: 'Switch Core',
          category: 'network',
          type: 'Switch',
          layerId: 'layer-fo',
        },
      },
    ],
    metadata: {
      relations: [
        {
          id: 'relation-1',
          sourceAssetId: 'asset-a',
          targetAssetId: 'asset-b',
          relationType: 'connected-to',
          layerId: 'layer-fo',
        },
      ],
      networks: [
        {
          id: 'network-fo',
          name: 'Fiber Optic',
          category: 'fiber-optic',
          assetIds: ['asset-a', 'asset-b'],
          relationIds: ['relation-1'],
          colorToken: 'network-fo',
          isDefaultVisible: true,
        },
      ],
    },
  }
  const snapshot = structuredClone(parserOutput)

  const output = adaptNetworkMapData({ parserOutput, context })

  assert.deepEqual(parserOutput, snapshot)
  assert.deepEqual(output.assets[0].geometry.coordinates, [110.4167, -6.9667, 12])
  assert.equal(output.relations.length, 1)
  assert.equal(output.relations[0].sourceAssetId, 'A-001')
  assert.equal(output.relations[0].targetAssetId, 'A-002')
  assert.deepEqual(output.networks[0].assetIds, ['A-001', 'A-002'])
  assert.equal(output.networks[0].relationIds[0], 'relation-1')
  assert.equal(validateNetworkMapData(output).valid, true)
})

test('adapter never infers relations from nearby markers', () => {
  const parserOutput = {
    assets: [
      {
        id: 'near-a',
        assetId: 'near-a',
        name: 'Near A',
        category: 'cctv',
        type: 'CCTV',
        geometry: { type: 'Point', coordinates: [110, -6] },
      },
      {
        id: 'near-b',
        assetId: 'near-b',
        name: 'Near B',
        category: 'cctv',
        type: 'CCTV',
        geometry: { type: 'Point', coordinates: [110.000001, -6.000001] },
      },
    ],
  }

  const output = adaptNetworkMapData({
    parserOutput,
    context: { ...context, selectedNetworkIds: [] },
  })

  assert.deepEqual(output.relations, [])
  assert.deepEqual(output.networks[0].assetIds, ['near-a', 'near-b'])
  assert.deepEqual(output.networks[0].relationIds, [])
})

test('adapter keeps legacy display coordinates out of geographic geometry', () => {
  const output = adaptNetworkMapData({
    parserOutput: {
      assets: [
        {
          id: 'legacy-a',
          name: 'Legacy A',
          type: 'CCTV',
          x: 0.25,
          y: 0.75,
        },
      ],
    },
    context: { ...context, selectedNetworkIds: [] },
  })

  assert.equal(output.assets[0].geometry, null)
  assert.deepEqual(output.assets[0].properties.displayPosition, {
    x: 0.25,
    y: 0.75,
    coordinateSpace: 'viewport-normalized',
  })
})

test('adapter excludes records explicitly assigned to a different active dataset', () => {
  const output = adaptNetworkMapData({
    parserOutput: {
      assets: [
        {
          id: 'valid',
          name: 'Valid',
          type: 'OTB',
          geometry: { type: 'Point', coordinates: [110, -6] },
        },
        {
          id: 'other-version',
          name: 'Other',
          type: 'OTB',
          datasetVersionId: 'dataset-v11',
          geometry: { type: 'Point', coordinates: [111, -7] },
        },
      ],
    },
    context: { ...context, selectedNetworkIds: [] },
  })

  assert.deepEqual(output.assets.map((asset) => asset.id), ['valid'])
  assert.ok(output.warnings.some((warning) => warning.includes('dataset-v11')))
})

test('runtime guards recognize the normalized contract', () => {
  const output = adaptNetworkMapData({
    parserOutput: {
      assets: [
        {
          id: 'asset-a',
          name: 'Asset A',
          category: 'network',
          type: 'Switch',
          geometry: { type: 'Point', coordinates: [110, -6] },
        },
        {
          id: 'asset-b',
          name: 'Asset B',
          category: 'network',
          type: 'Server',
          geometry: { type: 'Point', coordinates: [111, -7] },
        },
      ],
      relations: [
        {
          id: 'relation-a-b',
          sourceAssetId: 'asset-a',
          targetAssetId: 'asset-b',
          relationType: 'connected-to',
        },
      ],
    },
    context: { ...context, selectedNetworkIds: [] },
  })

  assert.ok(isMapContext(output.context))
  assert.ok(output.assets.every(isAssetNode))
  assert.ok(output.relations.every(isAssetRelation))
  assert.ok(output.networks.every(isAssetNetwork))
})

test('adapter supports the current project data shape without changing display coordinates', () => {
  const output = adaptNetworkMapData({
    parserOutput: {
      assets: currentAssets,
      networks: currentNetworks,
    },
    context: {
      ...activeContext,
      selectedNetworkIds: ['backbone-fo', 'cctv-ring'],
    },
  })

  assert.equal(output.assets.length, currentAssets.length)
  assert.equal(output.networks.length, currentNetworks.length)
  assert.deepEqual(output.context.selectedNetworkIds, ['backbone-fo', 'cctv-ring'])
  assert.ok(output.relations.length > 0)
  assert.ok(output.assets.every((asset) => asset.geometry === null))
  assert.equal(output.assets[0].properties.displayPosition.coordinateSpace, 'viewport-normalized')
  assert.equal(validateNetworkMapData(output).valid, true)
})
