import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../src/app.js'

test('topology roots API forwards the graph revision and authenticates viewers', async (t) => {
  const calls = []
  const app = createApp({
    authenticator: { authenticate() { return { id: 'viewer-1' } } },
    topologyService: {
      async getRoots(...args) {
        calls.push(args)
        return {
          datasetVersionId: args[0],
          graphRevision: args[1].graphRevision,
          roots: [],
          directionCoverage: { coverageStatus: 'none' },
        }
      },
    },
  })
  await listen(app)
  t.after(() => app.close())

  const address = app.address()
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/dataset-versions/dv-1/topology/roots`
      + '?graphRevision=topology-graph%3Aabc',
    { headers: { authorization: 'Bearer viewer' } },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    datasetVersionId: 'dv-1',
    graphRevision: 'topology-graph:abc',
    roots: [],
    directionCoverage: { coverageStatus: 'none' },
  })
  assert.deepEqual(calls, [['dv-1', { graphRevision: 'topology-graph:abc' }]])
})

test('topology impact API forwards failure simulation and correlation metadata', async (t) => {
  const calls = []
  const app = createApp({
    authenticator: { authenticate() { return { id: 'viewer-1' } } },
    topologyService: {
      async impact(...args) {
        calls.push(args)
        return {
          status: 'completed',
          datasetVersionId: args[0],
          graphRevision: args[1].graphRevision,
          failure: args[1].failureId,
        }
      },
    },
  })
  await listen(app)
  t.after(() => app.close())

  const address = app.address()
  const body = {
    failureType: 'asset',
    failureId: 'switch-1',
    graphRevision: 'topology-graph:abc',
    rootAssetIds: ['core-1'],
  }
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/dataset-versions/dv-1/topology/impact`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer viewer',
        'content-type': 'application/json',
        'x-correlation-id': 'impact-api-test',
      },
      body: JSON.stringify(body),
    },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'completed',
    datasetVersionId: 'dv-1',
    graphRevision: body.graphRevision,
    failure: body.failureId,
  })
  assert.deepEqual(calls, [[
    'dv-1',
    body,
    'viewer-1',
    'impact-api-test',
  ]])
})

async function listen(app) {
  await new Promise((resolve, reject) => {
    app.once('error', reject)
    app.listen(0, '127.0.0.1', resolve)
  })
}
