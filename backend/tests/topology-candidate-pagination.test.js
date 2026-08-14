import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCandidateCollectionRevision,
  MAX_CANDIDATE_PAGE_SIZE,
  normalizeCandidateQuery,
  paginateCandidates,
  TopologyCandidateQueryIndex,
} from '../src/topology/topology-candidate-pagination.js'

test('candidate cursor keeps score descending and candidate ID ascending order', () => {
  const candidates = [
    candidate('candidate-c', 0.8),
    candidate('candidate-b', 0.9),
    candidate('candidate-a', 0.9),
    candidate('candidate-d', 0.7),
  ]
  const index = new TopologyCandidateQueryIndex(candidates)
  const first = paginateCandidates(index, {
    limit: 2,
    graphRevision: 'topology-graph:one',
  })
  assert.deepEqual(first.items.map(({ candidateId }) => candidateId), [
    'candidate-a',
    'candidate-b',
  ])
  assert.equal(first.pageInfo.total, 4)
  assert.equal(first.pageInfo.hasNextPage, true)

  const second = paginateCandidates(index, {
    limit: 2,
    cursor: first.nextCursor,
    graphRevision: 'topology-graph:one',
  })
  assert.deepEqual(second.items.map(({ candidateId }) => candidateId), [
    'candidate-c',
    'candidate-d',
  ])
  assert.equal(second.nextCursor, null)
})

test('candidate query index applies status, site aliases, family, and score filters server-side', () => {
  const index = new TopologyCandidateQueryIndex([
    candidate('candidate-site-a', 0.8, {
      siteId: 'site-a',
      networkFamily: 'fiber_optic',
    }),
    candidate('candidate-source-site-b', 0.9, {
      sourceSiteId: 'site-b',
      networkFamily: 'fiber_optic',
      candidateStatus: 'ambiguous',
    }),
    candidate('candidate-path-site-c', 0.95, {
      sourcePathSiteId: 'site-c',
      networkFamily: 'cctv',
    }),
  ])
  const page = paginateCandidates(index, {
    status: 'ambiguous',
    site: 'site-b',
    networkFamily: 'fiber_optic',
    minScore: 0.85,
  })
  assert.deepEqual(page.items.map(({ candidateId }) => candidateId), [
    'candidate-source-site-b',
  ])
})

test('candidate review queue applies type, proposal, distance, asset, and required filters', () => {
  const index = new TopologyCandidateQueryIndex([
    candidate('candidate-required', 0.92, {
      candidateType: 'endpoint_device',
      proposalStatus: 'recommended',
      distanceMeters: 1.2,
      sourcePathAssetId: 'CABLE-01',
      targetAssetId: 'CAM-01',
      topologyRequired: true,
    }),
    candidate('candidate-optional', 0.95, {
      candidateType: 'inline_device',
      proposalStatus: 'ambiguous',
      distanceMeters: 0.5,
      targetAssetId: 'CAM-02',
      topologyRequired: false,
    }),
  ])
  const page = paginateCandidates(index, {
    candidateType: 'endpoint_device',
    proposalStatus: 'recommended',
    minDistance: 1,
    maxDistance: 2,
    assetSearch: 'cam-01',
    requiredTopologyOnly: true,
  })
  assert.deepEqual(page.items.map(({ candidateId }) => candidateId), [
    'candidate-required',
  ])
})

test('candidate cursor is bound to its query and both topology snapshots', () => {
  const candidates = [candidate('candidate-a', 0.9), candidate('candidate-b', 0.8)]
  const first = paginateCandidates(candidates, {
    limit: 1,
    status: 'candidate',
    graphRevision: 'topology-graph:one',
  })

  assert.throws(
    () => paginateCandidates(candidates, {
      limit: 1,
      cursor: first.nextCursor,
      status: 'ambiguous',
      graphRevision: 'topology-graph:one',
    }),
    (error) => error.code === 'topology_candidate_cursor_query_mismatch',
  )
  assert.throws(
    () => paginateCandidates(candidates, {
      limit: 1,
      cursor: first.nextCursor,
      status: 'candidate',
      graphRevision: 'topology-graph:two',
    }),
    (error) => error.code === 'topology_candidate_cursor_stale',
  )
  assert.throws(
    () => paginateCandidates([
      candidate('candidate-a', 0.9),
      candidate('candidate-b', 0.81),
    ], {
      limit: 1,
      cursor: first.nextCursor,
      status: 'candidate',
      graphRevision: 'topology-graph:one',
    }),
    (error) => error.code === 'topology_candidate_cursor_stale',
  )
})

test('candidate query normalization enforces bounded page size and score range', () => {
  assert.deepEqual(normalizeCandidateQuery({}), {
    status: null,
    site: null,
    networkFamily: null,
    candidateType: null,
    proposalStatus: null,
    minScore: null,
    maxScore: null,
    minDistance: null,
    maxDistance: null,
    assetSearch: null,
    requiredTopologyOnly: false,
    cursor: null,
    limit: 100,
  })
  assert.equal(
    normalizeCandidateQuery({ limit: MAX_CANDIDATE_PAGE_SIZE }).limit,
    MAX_CANDIDATE_PAGE_SIZE,
  )
  assert.throws(
    () => normalizeCandidateQuery({ limit: MAX_CANDIDATE_PAGE_SIZE + 1 }),
    (error) => error.code === 'invalid_topology_candidate_limit',
  )
  assert.throws(
    () => normalizeCandidateQuery({ minScore: 1.1 }),
    (error) => error.code === 'invalid_topology_candidate_score',
  )
})

test('candidate collection revision is independent of source array order', () => {
  const left = [candidate('candidate-b', 0.8), candidate('candidate-a', 0.9)]
  const right = [candidate('candidate-a', 0.9), candidate('candidate-b', 0.8)]
  assert.equal(
    createCandidateCollectionRevision(left),
    createCandidateCollectionRevision(right),
  )
})

function candidate(candidateId, score, overrides = {}) {
  return {
    candidateId,
    score,
    candidateStatus: 'candidate',
    siteId: 'site-default',
    networkFamily: 'cctv',
    ...overrides,
  }
}
