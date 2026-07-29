import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseTopologyViewState,
  serializeTopologyViewState,
} from '../src/domain/topology-view-state.js'

test('topology URL state keeps only valid opaque asset and candidate identifiers', () => {
  const state = parseTopologyViewState(
    '?selectedAssetId=CAM-01&reviewCandidateId=candidate-1&grouping=network'
      + '&labels=all&categories=cctv,fiber-optic&traceFrom=CAM-01&traceTo=SW-01',
    {
      assetIds: ['CAM-01', 'SW-01'],
      candidateIds: ['candidate-1'],
    },
  )

  assert.equal(state.selectedAssetId, 'CAM-01')
  assert.equal(state.reviewCandidateId, 'candidate-1')
  assert.equal(state.groupingMode, 'network')
  assert.equal(state.labelMode, 'all')
  assert.deepEqual([...state.selectedCategories], ['cctv', 'fiber-optic'])
  assert.equal(state.traceFrom, 'CAM-01')
  assert.equal(state.traceTo, 'SW-01')
})

test('topology URL serialization preserves cross-view selection and trace', () => {
  const query = serializeTopologyViewState('?datasetId=dataset-1&branchId=site-1', {
    selectedAssetId: 'CAM-01',
    reviewCandidateId: null,
    groupingMode: 'component',
    labelMode: 'auto',
    selectedCategories: new Set(['cctv']),
    search: '',
    focusOnly: true,
    traceFrom: 'CAM-01',
    traceTo: 'SW-01',
  })
  const params = new URLSearchParams(query)

  assert.equal(params.get('datasetId'), 'dataset-1')
  assert.equal(params.get('branchId'), 'site-1')
  assert.equal(params.get('selectedAssetId'), 'CAM-01')
  assert.equal(params.get('categories'), 'cctv')
  assert.equal(params.get('focus'), 'neighbors')
  assert.equal(params.get('traceTo'), 'SW-01')
})
