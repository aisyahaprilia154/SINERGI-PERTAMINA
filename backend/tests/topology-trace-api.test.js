import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../src/app.js'

test('topology trace API authenticates a viewer and forwards the graph revision contract', async (t) => {
  const calls = []
  const app = createApp({
    authenticator: {
      authenticate() {
        return { id: 'viewer-1' }
      },
    },
    topologyService: {
      async trace(...args) {
        calls.push(args)
        return {
          status: 'found',
          datasetVersionId: args[0],
          graphRevision: args[1].graphRevision,
          sourceAssetId: args[1].sourceAssetId,
        }
      },
    },
  })
  await new Promise((resolve, reject) => {
    app.once('error', reject)
    app.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => app.close())

  const address = app.address()
  const requestBody = {
    sourceAssetId: 'asset-a',
    targetAssetId: 'asset-b',
    graphRevision: 'topology-graph:abc',
    direction: 'both',
  }
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/dataset-versions/dv-1/topology/trace`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer viewer',
        'content-type': 'application/json',
        'x-correlation-id': 'trace-api-test',
      },
      body: JSON.stringify(requestBody),
    },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: 'found',
    datasetVersionId: 'dv-1',
    graphRevision: 'topology-graph:abc',
    sourceAssetId: 'asset-a',
  })
  assert.deepEqual(calls, [['dv-1', requestBody, 'viewer-1', 'trace-api-test']])
})

test('manual topology relation API is administrator-only and forwards device references', async (t) => {
  const calls = []
  const app = createApp({
    authenticator: {
      authenticate() {
        return { id: 'admin-1', role: 'Administrator' }
      },
    },
    topologyService: {
      async createDeviceRelation(...args) {
        calls.push(args)
        return {
          datasetVersionId: args[0],
          auditEventId: 'audit-1',
          relation: {
            sourceAssetId: args[2].sourceAssetId,
            targetAssetId: args[2].targetAssetId,
            provenance: 'manual_admin',
          },
        }
      },
    },
  })
  await new Promise((resolve, reject) => {
    app.once('error', reject)
    app.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => app.close())

  const address = app.address()
  const requestBody = {
    sourceAssetId: 'asset-a',
    targetAssetId: 'asset-b',
    relationType: 'connected-to',
    direction: 'undirected',
    reason: 'Diverifikasi dari dokumentasi lapangan.',
  }
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/dataset-versions/dv-1/topology/relations`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin',
        'content-type': 'application/json',
        'idempotency-key': 'manual-relation-api-2026-08-04-001',
        'x-correlation-id': 'manual-relation-api-test',
      },
      body: JSON.stringify(requestBody),
    },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    datasetVersionId: 'dv-1',
    auditEventId: 'audit-1',
    relation: {
      sourceAssetId: 'asset-a',
      targetAssetId: 'asset-b',
      provenance: 'manual_admin',
    },
  })
  assert.deepEqual(calls, [[
    'dv-1',
    'admin-1',
    {
      ...requestBody,
      idempotencyKey: 'manual-relation-api-2026-08-04-001',
      correlationId: 'manual-relation-api-test',
    },
  ]])
})

test('line label bulk topology API forwards the dedicated confirmation action', async (t) => {
  const calls = []
  const app = createApp({
    authenticator: {
      authenticate() {
        return { id: 'admin-1', role: 'Administrator' }
      },
    },
    topologyService: {
      async confirmLineLabelCandidates(...args) {
        calls.push(args)
        return {
          action: 'confirm_line_labels',
          affectedCount: 4,
        }
      },
    },
  })
  await new Promise((resolve, reject) => {
    app.once('error', reject)
    app.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => app.close())

  const address = app.address()
  const requestBody = {
    reason: 'Endpoint garis diverifikasi dari sumber resmi.',
  }
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/dataset-versions/dv-1/topology/confirm-line-labels`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin',
        'content-type': 'application/json',
        'idempotency-key': 'bulk-review-api-2026-08-04-001',
        'x-correlation-id': 'bulk-review-api-test',
      },
      body: JSON.stringify(requestBody),
    },
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    action: 'confirm_line_labels',
    affectedCount: 4,
  })
  assert.deepEqual(calls, [[
    'dv-1',
    'admin-1',
    {
      ...requestBody,
      idempotencyKey: 'bulk-review-api-2026-08-04-001',
      correlationId: 'bulk-review-api-test',
    },
  ]])
})
