import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateRelationReadiness } from '../src/domain/relation-readiness.js'

const assets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('readiness separates confirmed, pending, and isolated topology data', () => {
  const result = evaluateRelationReadiness({
    assets,
    topologyGraph: { edges: [
      { sourceNodeId: 'a', targetNodeId: 'b', verificationStatus: 'confirmed' },
      { sourceNodeId: 'b', targetNodeId: 'c', relationStatus: 'inferred_pending' },
    ] },
    selectedAssetId: 'c',
  })
  assert.equal(result.confirmedEdgeCount, 1)
  assert.equal(result.pendingEdgeCount, 1)
  assert.equal(result.isolatedNodeCount, 1)
  assert.equal(result.canTrace, false)
  assert.equal(result.canCreateDiagram, false)
  assert.match(result.unavailableReason, /Relasi aset belum tersedia/)
})

test('zero-edge scope cannot trace or create a diagram', () => {
  const result = evaluateRelationReadiness({ assets, topologyGraph: { edges: [] } })
  assert.equal(result.canTrace, false)
  assert.equal(result.canCreateDiagram, false)
  assert.match(result.unavailableReason, /3 aset ditemukan/)
})
