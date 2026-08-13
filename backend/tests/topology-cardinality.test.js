import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findTopologyCandidateConflicts,
  topologyCandidateCardinality,
  topologyCandidateDecisionKey,
} from '../src/topology/topology-cardinality.js'

test('inline device cardinality is scoped to the device and path', () => {
  const firstPath = {
    candidateId: 'candidate:first-path',
    candidateType: 'inline_device',
    sourceEndpointId: 'inline:T-021',
    sourcePathAssetId: 'FO-JB-011',
    targetAssetId: 'T-021',
  }
  const secondPath = {
    ...firstPath,
    candidateId: 'candidate:second-path',
    sourcePathAssetId: 'FO-JB-011.1',
  }

  assert.notEqual(topologyCandidateDecisionKey(firstPath), topologyCandidateDecisionKey(secondPath))
  assert.equal(topologyCandidateCardinality(firstPath).scope, 'device_path')
  assert.deepEqual(findTopologyCandidateConflicts([firstPath, secondPath]), [])
})

test('same path and device remains an exclusive decision slot', () => {
  const candidates = [
    {
      candidateId: 'candidate:one',
      candidateType: 'inline_device',
      sourceEndpointId: 'inline:T-021',
      sourcePathAssetId: 'FO-JB-011',
      targetAssetId: 'T-021',
    },
    {
      candidateId: 'candidate:two',
      candidateType: 'inline_device',
      sourceEndpointId: 'inline:T-021',
      sourcePathAssetId: 'FO-JB-011',
      targetAssetId: 'T-021',
    },
  ]

  const [conflict] = findTopologyCandidateConflicts(candidates)
  assert.equal(conflict.conflictScope, 'device_path')
  assert.deepEqual(conflict.candidateIds, ['candidate:one', 'candidate:two'])
})

test('ordinary line endpoint remains exclusive by source endpoint', () => {
  const conflicts = findTopologyCandidateConflicts([
    {
      candidateId: 'candidate:one',
      candidateType: 'endpoint_device',
      sourceEndpointId: 'endpoint:FO-01:start',
      sourcePathAssetId: 'FO-01',
      targetAssetId: 'A',
    },
    {
      candidateId: 'candidate:two',
      candidateType: 'endpoint_device',
      sourceEndpointId: 'endpoint:FO-01:start',
      sourcePathAssetId: 'FO-01',
      targetAssetId: 'B',
    },
  ])

  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].conflictScope, 'source_endpoint')
})
