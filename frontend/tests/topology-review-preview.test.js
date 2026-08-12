import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeTopologyReviewFailure,
  resolveTopologyReviewAvailability,
} from '../src/domain/topology-review-preview.js'

test('review availability rejects a frontend/backend contract skew before mutation', () => {
  assert.equal(resolveTopologyReviewAvailability({}).available, false)
  assert.equal(resolveTopologyReviewAvailability({
    reviewCapabilities: {
      safePreview: true,
      deltaValidation: true,
      confirmSelected: true,
    },
  }).available, true)
})

test('preview diagnosis separates new blockers from preserved baseline issues', () => {
  const result = describeTopologyReviewFailure({
    safeToApply: false,
    ineligible: [{
      candidateId: 'candidate:stale',
      reason: 'candidate_stable_asset_id_required',
    }],
    validationPreview: {
      summary: {
        errors: 2,
        introducedErrors: 2,
        baselineErrors: 113,
      },
    },
    diagnostics: {
      conflictCount: 1,
      blockingReasonCodes: ['endpoint_conflict'],
      baselineIssuesPreserved: 113,
      recommendation: {
        code: 'assign_identity_and_regenerate',
        message: 'Tetapkan Asset ID resmi lalu regenerate topology.',
      },
    },
  })

  assert.match(result.message, /1 kandidat belum memiliki Asset ID stabil/)
  assert.match(result.message, /1 konflik endpoint/)
  assert.match(result.message, /2 validation error baru/)
  assert.doesNotMatch(result.message, /pilihan tanpa konflik/)
})

test('missing bulk endpoint becomes an actionable deployment-skew diagnosis', () => {
  const result = describeTopologyReviewFailure({
    status: 404,
    code: 'not_found',
    message: 'Endpoint tidak ditemukan.',
  })
  assert.equal(result.code, 'topology_review_api_unavailable')
  assert.match(result.message, /Restart atau deploy ulang backend/)
})
