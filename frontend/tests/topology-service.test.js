import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTopologyRelation,
  analyzeTopologyImpact,
  loadAllTopologyCandidates,
  loadTopologyProjection,
  loadTopologyRoots,
  reviewTopologyBulk,
  reviewTopologyCandidate,
  traceTopology,
} from '../src/services/active-dataset-service.js'

test('topology projection uses the versioned backend endpoint', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ graph: { nodes: [], edges: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await loadTopologyProjection({
      datasetVersionId: 'dv-1',
      projection: 'graph',
      token: 'viewer',
    })
    assert.equal(request.url, '/api/dataset-versions/dv-1/topology/graph')
    assert.equal(request.options.headers.Authorization, 'Bearer viewer')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('candidate projection serializes server-side filters and cursor parameters', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await loadTopologyProjection({
      datasetVersionId: 'dv-1',
      projection: 'candidates',
      status: 'ambiguous',
      site: 'site-a',
      networkFamily: 'fiber_optic',
      minScore: 0.55,
      cursor: 'opaque-cursor',
      limit: 100,
      token: 'admin',
    })
    assert.equal(
      request.url,
      '/api/dataset-versions/dv-1/topology/candidates'
        + '?status=ambiguous&site=site-a&networkFamily=fiber_optic'
        + '&minScore=0.55&cursor=opaque-cursor&limit=100',
    )
    assert.equal(request.options.headers.Authorization, 'Bearer admin')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('all candidate pages are combined only when their revisions remain stable', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    const page = requests.length === 1
      ? {
        items: [{ candidateId: 'candidate-a' }, { candidateId: 'candidate-b' }],
        nextCursor: 'next-page',
        graphRevision: 'topology-graph:one',
        candidateRevision: 'topology-candidates:one',
        pageInfo: { total: 3 },
      }
      : {
        items: [{ candidateId: 'candidate-c' }],
        nextCursor: null,
        graphRevision: 'topology-graph:one',
        candidateRevision: 'topology-candidates:one',
        pageInfo: { total: 3 },
      }
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await loadAllTopologyCandidates({
      datasetVersionId: 'dv-1',
      token: 'admin',
    })
    assert.deepEqual(result.items.map(({ candidateId }) => candidateId), [
      'candidate-a',
      'candidate-b',
      'candidate-c',
    ])
    assert.equal(result.pageInfo.hasNextPage, false)
    assert.equal(result.pageInfo.total, 3)
    assert.match(requests[0].url, /[?]limit=500$/)
    assert.match(requests[1].url, /[?]cursor=next-page&limit=500$/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('all candidate pages reduce their limit when a response exceeds the byte budget', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(url)
    if (url.endsWith('limit=500')) {
      return new Response(JSON.stringify({
        error: {
          code: 'topology_candidate_response_too_large',
          message: 'Response candidate terlalu besar.',
        },
      }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      items: [{ candidateId: 'candidate-a' }],
      nextCursor: null,
      graphRevision: 'topology-graph:one',
      candidateRevision: 'topology-candidates:one',
      pageInfo: { total: 1 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await loadAllTopologyCandidates({
      datasetVersionId: 'dv-1',
      token: 'admin',
    })
    assert.deepEqual(result.items.map(({ candidateId }) => candidateId), ['candidate-a'])
    assert.match(requests[0], /[?]limit=500$/)
    assert.match(requests[1], /[?]limit=250$/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('candidate mutation sends only the selected review action and body', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ candidate: { candidateStatus: 'confirmed' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await reviewTopologyCandidate({
      candidateId: 'candidate-1',
      action: 'confirm',
      body: { reason: 'Evidence diverifikasi.' },
      token: 'admin',
    })
    assert.equal(request.url, '/api/topology/candidates/candidate-1/confirm')
    assert.equal(request.options.method, 'POST')
    assert.deepEqual(JSON.parse(request.options.body), { reason: 'Evidence diverifikasi.' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('bulk topology mutation uses the versioned admin endpoint', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ affectedCount: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await reviewTopologyBulk({
      datasetVersionId: 'dv-1',
      action: 'confirm-all',
      reason: 'Review bulk pilot.',
      token: 'admin',
    })
    await reviewTopologyBulk({
      datasetVersionId: 'dv-1',
      action: 'confirm-selected',
      candidateIds: ['candidate-1', 'candidate-2'],
      reason: 'Pilihan koneksi sudah diverifikasi.',
      expectedGraphRevision: 4,
      expectedCandidateRevision: 7,
      token: 'admin',
    })
    await reviewTopologyBulk({
      datasetVersionId: 'dv-1',
      action: 'confirm-line-labels',
      reason: 'Endpoint garis terverifikasi.',
      token: 'admin',
    })
    await reviewTopologyBulk({
      datasetVersionId: 'dv-1',
      action: 'revoke-all',
      reason: 'Perlu verifikasi ulang.',
      token: 'admin',
    })
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        '/api/dataset-versions/dv-1/topology/confirm-all',
        '/api/dataset-versions/dv-1/topology/confirm-selected',
        '/api/dataset-versions/dv-1/topology/confirm-line-labels',
        '/api/dataset-versions/dv-1/topology/revoke-all',
      ],
    )
    assert.ok(requests.every(({ options }) => options.method === 'POST'))
    assert.deepEqual(
      requests.map(({ options }) => JSON.parse(options.body)),
      [
        { reason: 'Review bulk pilot.' },
        {
          reason: 'Pilihan koneksi sudah diverifikasi.',
          candidateIds: ['candidate-1', 'candidate-2'],
          expectedGraphRevision: 4,
          expectedCandidateRevision: 7,
        },
        { reason: 'Endpoint garis terverifikasi.' },
        { reason: 'Perlu verifikasi ulang.' },
      ],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('manual topology relation sends the selected device pair and audit reason', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      auditEventId: 'audit-1',
      relation: { provenance: 'manual_admin' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await createTopologyRelation({
      datasetVersionId: 'dv-1',
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      reason: 'Diverifikasi dari dokumentasi lapangan.',
      token: 'admin',
    })
    assert.equal(result.auditEventId, 'audit-1')
    assert.equal(request.url, '/api/dataset-versions/dv-1/topology/relations')
    assert.equal(request.options.method, 'POST')
    assert.equal(request.options.headers.Authorization, 'Bearer admin')
    assert.deepEqual(JSON.parse(request.options.body), {
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      relationType: 'connected-to',
      direction: 'undirected',
      reason: 'Diverifikasi dari dokumentasi lapangan.',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('missing bulk route is reported as frontend/backend deployment skew', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 'not_found',
      message: 'Endpoint tidak ditemukan.',
    },
  }), {
    status: 404,
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'corr-review-skew',
    },
  })
  try {
    await assert.rejects(
      reviewTopologyBulk({
        datasetVersionId: 'dv-1',
        action: 'confirm-selected',
        candidateIds: ['candidate-1'],
        reason: 'Sudah diperiksa.',
        token: 'admin',
      }),
      (error) => error.code === 'topology_review_api_unavailable'
        && error.details.correlationId === 'corr-review-skew',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('manual topology relation forwards optional graph evidence references', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ relation: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await createTopologyRelation({
      datasetVersionId: 'dv-1',
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      relationKind: 'service_link',
      pathAssetIds: ['FO-01'],
      sourceGeometryIds: ['geometry:fo-01'],
      evidenceRefs: ['document:network-plan:page-3'],
      reason: 'Diverifikasi dari dokumentasi resmi.',
      token: 'admin',
    })
    assert.deepEqual(JSON.parse(request.options.body), {
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      relationType: 'connected-to',
      relationKind: 'service_link',
      direction: 'undirected',
      pathAssetIds: ['FO-01'],
      sourceGeometryIds: ['geometry:fo-01'],
      reason: 'Diverifikasi dari dokumentasi resmi.',
      evidenceRefs: ['document:network-plan:page-3'],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('authoritative trace request includes source, target, direction, and graph revision', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      status: 'found',
      graphRevision: 'topology-graph:abc',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await traceTopology({
      datasetVersionId: 'dv-1',
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      graphRevision: 'topology-graph:abc',
      direction: 'both',
      token: 'viewer',
    })
    assert.equal(result.status, 'found')
    assert.equal(request.url, '/api/dataset-versions/dv-1/topology/trace')
    assert.equal(request.options.method, 'POST')
    assert.equal(request.options.headers.Authorization, 'Bearer viewer')
    assert.deepEqual(JSON.parse(request.options.body), {
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      graphRevision: 'topology-graph:abc',
      direction: 'both',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fase 4 trace client adds explicit mode and bounded depth without changing legacy payloads', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ status: 'found' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await traceTopology({
      datasetVersionId: 'dv-1',
      sourceAssetId: 'cam-1',
      targetAssetId: 'core-1',
      graphRevision: 'topology-graph:abc',
      mode: 'point_to_point',
      direction: 'upstream',
      maxDepth: 25,
      token: 'viewer',
    })
    assert.deepEqual(JSON.parse(request.options.body), {
      sourceAssetId: 'cam-1',
      targetAssetId: 'core-1',
      graphRevision: 'topology-graph:abc',
      direction: 'upstream',
      mode: 'point_to_point',
      maxDepth: 25,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fase 4 roots and impact clients use the versioned operational endpoints', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ status: 'completed' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await loadTopologyRoots({
      datasetVersionId: 'dv-1',
      graphRevision: 'topology-graph:abc',
      token: 'viewer',
    })
    await analyzeTopologyImpact({
      datasetVersionId: 'dv-1',
      failureType: 'relation',
      failureId: 'relation-1',
      graphRevision: 'topology-graph:abc',
      rootAssetIds: ['core-1'],
      networkFamily: 'cctv',
      scopeAssetIds: ['core-1', 'switch-1'],
      token: 'viewer',
    })
    assert.equal(requests[0].url,
      '/api/dataset-versions/dv-1/topology/roots?graphRevision=topology-graph%3Aabc')
    assert.equal(requests[1].url, '/api/dataset-versions/dv-1/topology/impact')
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      failureType: 'relation',
      failureId: 'relation-1',
      graphRevision: 'topology-graph:abc',
      rootAssetIds: ['core-1'],
      networkFamily: 'cctv',
      scopeAssetIds: ['core-1', 'switch-1'],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
