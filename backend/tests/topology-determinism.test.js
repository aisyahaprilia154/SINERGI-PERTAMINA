import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaselineTopologyBundle } from './fixtures/topology-baseline-fixture.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'

test('property: topology artifact is invariant under deterministic input permutations', () => {
  const generatedAt = '2026-08-04T00:00:00.000Z'
  const baseline = generateRelationArtifacts(createBaselineTopologyBundle(), { generatedAt })

  for (let seed = 1; seed <= 12; seed += 1) {
    const permutedBundle = permuteTopologyInputs(createBaselineTopologyBundle(), seed)
    const actual = generateRelationArtifacts(permutedBundle, { generatedAt })
    assert.deepEqual(
      actual,
      baseline,
      `Urutan input seed ${seed} mengubah artifact topology.`,
    )
  }
})

function permuteTopologyInputs(bundle, seed) {
  const next = structuredClone(bundle)
  next.classifiedNodes = deterministicShuffle(next.classifiedNodes, seed + 1)
  next.classifiedPaths = deterministicShuffle(next.classifiedPaths, seed + 2)
  next.geometries = deterministicShuffle(next.geometries, seed + 3)
  next.explicitRelations = deterministicShuffle(next.explicitRelations, seed + 4)
  return next
}

function deterministicShuffle(items, seed) {
  const next = [...items]
  let state = seed >>> 0
  for (let index = next.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const swapIndex = state % (index + 1)
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}
