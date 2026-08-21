import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTopologyDiagramHref } from '../src/domain/topology-navigation.js'

test('map to topology navigation carries area, selection, and complete trace in URL state', () => {
  const href = buildTopologyDiagramHref({
    context: { datasetId: 'dataset-1', branchId: 'semarang' },
    area: 'ft-pengapon-semarang',
    selectedAssetId: 'C-001',
    traceFrom: 'CORE-01',
    traceTo: 'C-001',
  })
  const url = new URL(href, 'https://sinergi.local')

  assert.equal(url.pathname, '/topology')
  assert.equal(url.searchParams.get('view'), 'diagram')
  assert.equal(url.searchParams.get('area'), 'ft-pengapon-semarang')
  assert.equal(url.searchParams.get('selectedAssetId'), 'C-001')
  assert.equal(url.searchParams.get('traceFrom'), 'CORE-01')
  assert.equal(url.searchParams.get('traceTo'), 'C-001')
})

test('trace destination is omitted when the trace source is absent', () => {
  const href = buildTopologyDiagramHref({
    context: { datasetId: 'dataset-1', branchId: 'semarang' },
    traceTo: 'C-001',
  })
  const url = new URL(href, 'https://sinergi.local')
  assert.equal(url.searchParams.has('traceTo'), false)
})
