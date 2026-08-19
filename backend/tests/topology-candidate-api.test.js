import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../src/app.js'
import {
  MAX_CANDIDATE_RESPONSE_BYTES,
} from '../src/topology/topology-candidate-pagination.js'
import { TopologyService } from '../src/topology/topology-service.js'
import { TokenAuthenticator } from '../src/security/authorization.js'

test('candidate API paginates, filters, exposes revisions, and revalidates with ETag', async () => {
  const repository = new MemoryRepository([candidateRecord()])
  const app = createCandidateApp(repository)
  await listen(app)
  const origin = `http://127.0.0.1:${app.address().port}`

  try {
    const endpoint = `${origin}/api/dataset-versions/dv-candidates/topology/candidates`
      + '?status=candidate&site=site-a&networkFamily=fiber_optic&minScore=0.75&limit=2'
    const forbidden = await fetch(endpoint, {
      headers: { authorization: 'Bearer viewer-token' },
    })
    assert.equal(forbidden.status, 403)

    const firstResponse = await fetch(endpoint, {
      headers: { authorization: 'Bearer admin-token' },
    })
    const first = await firstResponse.json()
    assert.equal(firstResponse.status, 200)
    assert.deepEqual(first.items.map(({ candidateId }) => candidateId), [
      'candidate-a',
      'candidate-b',
    ])
    assert.equal(first.pageInfo.total, 3)
    assert.equal(first.pageInfo.hasNextPage, true)
    assert.equal(first.summary.candidate, 3)
    assert.equal(first.datasetSummary.ambiguous, 1)
    assert.ok(first.graphRevision)
    assert.ok(first.candidateRevision)
    assert.ok(first.nextCursor)
    assert.equal(firstResponse.headers.get('cache-control'), 'private, no-cache')
    assert.ok(firstResponse.headers.get('etag'))
    assert.equal(
      Number(firstResponse.headers.get('content-length')),
      Buffer.byteLength(JSON.stringify(first)),
    )
    assert.ok(
      Number(firstResponse.headers.get('content-length')) <= MAX_CANDIDATE_RESPONSE_BYTES,
    )

    const secondUrl = `${origin}/api/dataset-versions/dv-candidates/topology/candidates`
      + `?status=candidate&site=site-a&networkFamily=fiber_optic&minScore=0.75&limit=2`
      + `&cursor=${encodeURIComponent(first.nextCursor)}`
    const secondResponse = await fetch(secondUrl, {
      headers: { authorization: 'Bearer admin-token' },
    })
    const second = await secondResponse.json()
    assert.equal(secondResponse.status, 200)
    assert.deepEqual(second.items.map(({ candidateId }) => candidateId), ['candidate-c'])
    assert.equal(second.nextCursor, null)
    assert.equal(second.pageInfo.hasNextPage, false)

    const cached = await fetch(endpoint, {
      headers: {
        authorization: 'Bearer admin-token',
        'if-none-match': firstResponse.headers.get('etag'),
      },
    })
    assert.equal(cached.status, 304)
    assert.equal(await cached.text(), '')

    const mismatch = await fetch(
      `${origin}/api/dataset-versions/dv-candidates/topology/candidates`
        + `?status=ambiguous&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const mismatchBody = await mismatch.json()
    assert.equal(mismatch.status, 400)
    assert.equal(mismatchBody.error.code, 'topology_candidate_cursor_query_mismatch')

    const invalidLimit = await fetch(
      `${origin}/api/dataset-versions/dv-candidates/topology/candidates?limit=501`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    assert.equal(invalidLimit.status, 400)
    assert.equal((await invalidLimit.json()).error.code, 'invalid_topology_candidate_limit')

    const staleCursor = first.nextCursor
    await repository.update('dv-candidates', (record) => ({
      ...record,
      topologyCandidates: record.topologyCandidates.map((candidate) => (
        candidate.candidateId === 'candidate-c'
          ? { ...candidate, candidateStatus: 'confirmed' }
          : candidate
      )),
    }))
    const stale = await fetch(
      `${origin}/api/dataset-versions/dv-candidates/topology/candidates`
        + `?status=candidate&site=site-a&networkFamily=fiber_optic&minScore=0.75&limit=2`
        + `&cursor=${encodeURIComponent(staleCursor)}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const staleBody = await stale.json()
    assert.equal(stale.status, 409)
    assert.equal(staleBody.error.code, 'topology_candidate_cursor_stale')
  } finally {
    await close(app)
  }
})

test('candidate API rejects a page that exceeds its response byte budget', async () => {
  const record = candidateRecord()
  record.topologyCandidates[0].evidence = [
    { explanation: 'e'.repeat(MAX_CANDIDATE_RESPONSE_BYTES) },
  ]
  const repository = new MemoryRepository([record])
  const app = createCandidateApp(repository)
  await listen(app)
  const origin = `http://127.0.0.1:${app.address().port}`

  try {
    const response = await fetch(
      `${origin}/api/dataset-versions/dv-candidates/topology/candidates?status=candidate&limit=1`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const body = await response.json()
    assert.equal(response.status, 413)
    assert.equal(body.error.code, 'topology_candidate_response_too_large')
    assert.equal(body.error.details.maxBytes, MAX_CANDIDATE_RESPONSE_BYTES)
  } finally {
    await close(app)
  }
})

test('candidate API keeps large historical evidence out of every page response', async () => {
  const record = candidateRecord()
  record.topologyCandidateHistory = Array.from({ length: 40 }, (_, index) => ({
    ...candidate(`history-${index}`, 0.9),
    supersededAt: '2026-08-13T00:00:00.000Z',
    supersededByRunId: 'run-history',
    evidence: [{ explanation: 'e'.repeat(100000) }],
    review: {
      actorId: 'admin-1',
      reviewedAt: '2026-08-13T00:00:00.000Z',
      reason: 'History evidence.',
      action: 'confirm',
    },
  }))
  const repository = new MemoryRepository([record])
  const app = createCandidateApp(repository)
  await listen(app)
  const origin = `http://127.0.0.1:${app.address().port}`

  try {
    const response = await fetch(
      `${origin}/api/dataset-versions/dv-candidates/topology/candidates?limit=1`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.deepEqual(body.history, [])
    assert.ok(Number(response.headers.get('content-length')) <= MAX_CANDIDATE_RESPONSE_BYTES)
  } finally {
    await close(app)
  }
})

test('candidate API keeps dataset-level registry data out of every page response', async () => {
  const record = candidateRecord()
  record.topologyInterfaceRegistry = Array.from({ length: 4000 }, (_, index) => ({
    interfaceId: `interface-${index}`,
    ownerAssetId: `asset-${index}`,
    componentId: `component-${index}`,
    interfaceType: 'fiber_port',
    serviceDomain: 'data',
    mediaType: 'fiber',
  }))
  record.topologyEligibilityIssues = Array.from({ length: 1000 }, (_, index) => ({
    issueId: `issue-${index}`,
    datasetVersionId: record.datasetVersion.id,
    severity: 'warning',
    issueCode: 'missing_stable_asset_id',
    scope: 'eligibility',
    message: `Object source-feature:${index} belum memiliki stable Asset ID.`,
    entityReference: `source-feature:${index}`,
    readinessImpact: 'warning',
  }))
  const repository = new MemoryRepository([record])
  const app = createCandidateApp(repository)
  await listen(app)
  const origin = `http://127.0.0.1:${app.address().port}`

  try {
    const response = await fetch(
      `${origin}/api/dataset-versions/dv-candidates/topology/candidates?limit=1`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.items.length, 1)
    assert.deepEqual(body.interfaceRegistry, [])
    assert.equal(body.interfaceRegistryCount, 4000)
    assert.equal(body.eligibilityIssues.length, 1000)
    assert.ok(Number(response.headers.get('content-length')) <= MAX_CANDIDATE_RESPONSE_BYTES)
  } finally {
    await close(app)
  }
})

function candidateRecord() {
  return {
    datasetVersion: {
      id: 'dv-candidates',
      datasetId: 'dataset-candidates',
      branchId: 'site-a',
    },
    topologyGraph: {
      datasetVersionId: 'dv-candidates',
      nodes: [],
      edges: [],
      components: [],
      degreeByNode: {},
      isolatedNodeIds: [],
    },
    topologyCandidates: [
      candidate('candidate-a', 0.9),
      candidate('candidate-b', 0.9),
      candidate('candidate-c', 0.8),
      candidate('candidate-d', 0.7, {
        siteId: 'site-b',
        networkFamily: 'fiber_optic',
      }),
      candidate('candidate-e', 0.95, {
        siteId: 'site-a',
        networkFamily: 'cctv',
        candidateStatus: 'ambiguous',
      }),
    ],
    topologyUnresolved: [],
    topologyEligibilityIssues: [],
    topologyLineworkIssues: [],
    topologyCandidateHistory: [],
    topologyRuns: [],
  }
}

function candidate(candidateId, score, overrides = {}) {
  return {
    candidateId,
    score,
    candidateStatus: 'candidate',
    siteId: 'site-a',
    networkFamily: 'fiber_optic',
    ...overrides,
  }
}

function createCandidateApp(repository) {
  return createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'admin-token': { id: 'admin-1', role: 'Administrator' },
      'viewer-token': { id: 'viewer-1', role: 'Viewer' },
    }),
    repository,
    fileStore: {},
    auditLog: new MemoryAuditLog(),
    jobQueue: {},
    importPipeline: {},
    lifecycleService: {},
    topologyService: new TopologyService({
      repository,
      auditLog: new MemoryAuditLog(),
    }),
  })
}

async function listen(app) {
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
}

async function close(app) {
  await new Promise((resolve, reject) => {
    app.close((error) => error ? reject(error) : resolve())
  })
}

class MemoryRepository {
  constructor(records) {
    this.records = new Map(records.map((record) => [record.datasetVersion.id, record]))
  }

  async get(id) {
    const record = this.records.get(id)
    if (!record) throw new Error(`missing record ${id}`)
    return structuredClone(record)
  }

  async update(id, updater) {
    const current = await this.get(id)
    const next = await updater(current)
    this.records.set(id, structuredClone(next))
    return structuredClone(next)
  }
}

class MemoryAuditLog {
  async record(event, input) {
    return { id: `audit-${event}`, event, ...structuredClone(input) }
  }
}
