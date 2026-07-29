import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadTopologyProjection,
  reviewTopologyCandidate,
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
