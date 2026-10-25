import test from 'node:test'
import assert from 'node:assert/strict'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
import { createMapReadModel, createNetworkSelectionState, mapSelectionQuery, readRequestedDatasetContext, mapSelectionOptions, parseMapUrlState } from '../src/domain/map-read-model.js'
import * as stateFacade from '../test-support/legacy/pages/map/network-sidebar-state.js'
import * as stateDomain from '../src/domain/map-selection.js'
import * as graphFacade from '../src/pages/map/network-tracing.js'
import * as graphDomain from '../src/domain/map-network-tracing.js'

test('read model composes active projection, area scope and canonical URL asset aliases without mutation', () => {
  const payload = structuredClone(fixtures.active), original = structuredClone(payload)
  const model = createMapReadModel(payload, '?selectedAssetId=C-01&selectedNetworkIds=&area=ft-semarang')
  assert.equal(model.selectedArea.key, 'ft-semarang')
  assert.equal(model.urlState.selectedAssetId, 'C-01')
  assert.deepEqual(model.urlState.selectedNetworkIds, [])
  assert.equal(model.assets.length, 2)
  assert.deepEqual(payload, original)
  assert.ok(model.topologyGraph.edges.every(edge => model.assetById[edge.sourceAssetId] && model.assetById[edge.targetAssetId]))
})
test('selection and serialization preserve explicit empty networks, stable IDs and unrelated query context', () => {
  const model = createMapReadModel(fixtures.active, '?other=keep&category=CCTV')
  const selection = createNetworkSelectionState({ ...model.selectionOptions, initialSelectedNetworkIds: [], initialSelectedAssetId: 'C-01' })
  const query = mapSelectionQuery('?other=keep', { ...model, selection })
  assert.equal(query.get('other'), 'keep'); assert.equal(query.get('selectedNetworkIds'), '')
  assert.equal(query.get('selectedAssetId'), 'C-01')
  assert.equal(query.get('area'), model.selectedArea.key)
  assert.equal(query.get('category'), 'CCTV')
})
test('dataset context has URL, storage and default precedence without requiring window', () => {
  assert.deepEqual(readRequestedDatasetContext('?datasetId=url&siteId=site', 'stored'), { datasetId: 'url', siteId: 'site' })
  assert.equal(readRequestedDatasetContext('', 'stored').datasetId, 'stored')
  assert.equal(readRequestedDatasetContext().datasetId, 'dataset-semarang')
})
test('compatibility facades preserve the same selection and graph function identities', () => {
  assert.equal(stateFacade.parseMapUrlState, stateDomain.parseMapUrlState)
  assert.equal(stateFacade.createNetworkSelectionState, stateDomain.createNetworkSelectionState)
  assert.equal(graphFacade.buildExplicitRelationGraph, graphDomain.buildExplicitRelationGraph)
  assert.equal(graphFacade.getConnectedAssets, graphDomain.getConnectedAssets)
})

test('selection options resolve a stable URL alias back to a runtime asset ID', () => {
  const options = mapSelectionOptions({ networks: [{ id: 'network', isDefaultVisible: true }], assets: [{ id: 'runtime-id', stableAssetId: 'canonical-id' }] })
  assert.equal(parseMapUrlState('?selectedAssetId=canonical-id', options).selectedAssetId, 'runtime-id')
  assert.deepEqual(options.defaultNetworkIds, ['network'])
})
