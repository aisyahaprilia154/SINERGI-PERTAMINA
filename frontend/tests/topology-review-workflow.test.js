import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterCandidatesByReviewQueue,
  humanReviewReasons,
  normalizeReviewQueue,
  reviewContractForCandidates,
  reviewProgress,
  reviewQueueForCandidate,
} from '../src/domain/topology-review-workflow.js'

test('review queues keep confirmable, ambiguous, and data issues separate', () => {
  const candidates = [
    {
      candidateId: 'ready',
      candidateStatus: 'candidate',
      proposalStatus: 'recommended',
      reviewEligibility: { confirmable: true, identityReady: true },
    },
    {
      candidateId: 'ambiguous',
      candidateStatus: 'ambiguous',
      proposalStatus: 'ambiguous',
      reviewEligibility: { confirmable: true, identityReady: true },
    },
    {
      candidateId: 'identity-conflict',
      candidateStatus: 'candidate',
      proposalStatus: 'recommended',
      reviewEligibility: { confirmable: false, identityReady: false },
    },
  ]

  assert.equal(reviewQueueForCandidate(candidates[0]), 'ready')
  assert.equal(reviewQueueForCandidate(candidates[1]), 'needs_choice')
  assert.equal(reviewQueueForCandidate(candidates[2]), 'data_issues')
  assert.deepEqual(
    filterCandidatesByReviewQueue(candidates, 'ready').map(({ candidateId }) => candidateId),
    ['ready'],
  )
})

test('legacy status values normalize to the practical queues', () => {
  assert.equal(normalizeReviewQueue('needs-review'), 'ready')
  assert.equal(normalizeReviewQueue('ambiguous'), 'needs_choice')
  assert.equal(normalizeReviewQueue('unresolved'), 'data_issues')
  assert.equal(normalizeReviewQueue('unknown'), 'ready')
})

test('progress counts decisions without hiding unresolved work', () => {
  const result = reviewProgress([
    { candidateStatus: 'confirmed' },
    { candidateStatus: 'rejected' },
    { candidateStatus: 'candidate' },
    { candidateStatus: 'ambiguous' },
  ])
  assert.deepEqual(result, { completed: 2, total: 4, remaining: 2 })
})

test('review contract reports preparation and data repair states', () => {
  assert.deepEqual(reviewContractForCandidates({ candidates: [], lastGeneratedAt: null }), {
    status: 'preparing',
    confirmable: false,
    userMessage: 'Sistem sedang menyelaraskan identitas aset dan memperbarui koneksi.',
    recoveryAction: null,
  })
  const result = reviewContractForCandidates({
    lastGeneratedAt: '2026-08-14T00:00:00Z',
    candidates: [{
      candidateStatus: 'candidate',
      proposalStatus: 'recommended',
      reviewEligibility: { identityReady: false, confirmable: false },
    }],
  })
  assert.equal(result.status, 'needs_data_fix')
  assert.equal(result.recoveryAction, 'review_data_issues')
})

test('review reasons turn scoring evidence into human language', () => {
  const reasons = humanReviewReasons({
    distanceMeters: 1.8,
    sourceLocationKey: 'site-a',
    targetLocationKey: 'site-a',
    scoreComponents: { labelCorrespondence: .8, interfaceCompatibility: .9 },
    constraintEvidence: { interfaceCapacityAvailable: true },
  })
  assert.deepEqual(reasons, [
    'Lokasi sama',
    'Nama kabel cocok',
    'Ujung kabel berada dekat perangkat',
    'Tipe jaringan cocok',
  ])
})
