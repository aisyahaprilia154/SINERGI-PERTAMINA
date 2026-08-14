import assert from 'node:assert/strict'
import test from 'node:test'

import { validateSchematicProjection } from '../src/pages/map/schematic-validation.js'

test('diagram validation proves exact node and confirmed-edge coverage', () => {
  const result = validateSchematicProjection({
    sourceAssets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    sourceConfirmedEdges: [{ sourceId: 'a', targetId: 'b' }],
    diagramNodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    diagramEdges: [{ sourceId: 'b', targetId: 'a', relationStatus: 'confirmed' }],
  })

  assert.equal(result.coveragePercent, 100)
  assert.equal(result.isCompleteCoverage, true)
  assert.equal(result.isConfirmedTopologyConsistent, true)
  assert.equal(result.unresolvedAssetCount, 1)
  assert.equal(result.isValid, true)
})

test('diagram validation reports missing IDs, duplicates, invalid endpoints, and fake edges', () => {
  const result = validateSchematicProjection({
    sourceAssets: [{ id: 'a' }, { id: 'b' }, { id: 'b' }],
    sourceConfirmedEdges: [{ sourceId: 'a', targetId: 'b' }],
    diagramNodes: [{ id: 'a' }, { id: 'a' }],
    diagramEdges: [
      { id: 'fake', sourceId: 'a', targetId: 'missing', relationStatus: 'confirmed' },
      { id: 'loop', sourceId: 'a', targetId: 'a', relationStatus: 'confirmed' },
    ],
  })

  assert.deepEqual(result.missingAssetIds, ['b'])
  assert.deepEqual(result.duplicateSourceAssetIds, ['b'])
  assert.deepEqual(result.duplicateDiagramNodeIds, ['a'])
  assert.deepEqual(result.invalidEndpoints, ['fake'])
  assert.deepEqual(result.selfLoops, ['loop'])
  assert.deepEqual(result.unexpectedConfirmedEdgeKeys, [])
  assert.equal(result.isValid, false)
})
