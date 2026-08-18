import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isStaleTopologyReviewError,
  topologyCandidateRequiresTargetSelection,
  topologyCandidateSupportsBulkReview,
  topologyReviewDecisionCandidates,
  topologyReviewDecisionKey,
} from '../src/domain/topology-review-decision.js'

test('ambiguous endpoint alternatives form one decision and are not bulk selectable', () => {
  const candidates = [{
    candidateId: 'candidate:c-024',
    candidateType: 'endpoint_device',
    candidateStatus: 'ambiguous',
    proposalStatus: 'ambiguous',
    sourceEndpointId: 'endpoint:stp-rs-c-026:end',
    targetAssetId: 'C-024',
  }, {
    candidateId: 'candidate:c-026',
    candidateType: 'endpoint_device',
    candidateStatus: 'ambiguous',
    proposalStatus: 'ambiguous',
    sourceEndpointId: 'endpoint:stp-rs-c-026:end',
    targetAssetId: 'C-026',
  }]

  assert.equal(topologyReviewDecisionKey(candidates[0]), topologyReviewDecisionKey(candidates[1]))
  assert.equal(topologyReviewDecisionCandidates(candidates, candidates[0]).length, 2)
  assert.equal(topologyCandidateRequiresTargetSelection(candidates[0], candidates), true)
  assert.equal(topologyCandidateSupportsBulkReview(candidates[0]), false)
})

test('recommended candidate remains bulk selectable', () => {
  assert.equal(topologyCandidateSupportsBulkReview({
    candidateStatus: 'candidate',
    proposalStatus: 'recommended',
    reviewEligibility: { confirmable: true },
  }), true)
})

test('inline decisions remain separated by path', () => {
  const first = {
    candidateType: 'inline_device',
    sourceEndpointId: 'inline:T-021',
    sourcePathAssetId: 'FO-A',
    targetAssetId: 'T-021',
  }
  const second = { ...first, sourcePathAssetId: 'FO-B' }
  assert.notEqual(topologyReviewDecisionKey(first), topologyReviewDecisionKey(second))
})

test('stale review responses are eligible for one projection reload and retry', () => {
  assert.equal(isStaleTopologyReviewError({ code: 'stale_topology_review' }), true)
  assert.equal(isStaleTopologyReviewError({ code: 'stale_topology_bulk_review' }), true)
  assert.equal(isStaleTopologyReviewError({ code: 'dataset_version_stale_revision' }), true)
  assert.equal(isStaleTopologyReviewError({ code: 'topology_candidate_conflict' }), false)
})
