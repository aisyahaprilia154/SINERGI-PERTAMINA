import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { JsonLinesAuditLog } from '../src/storage/audit-log.js'

test('HTTP correlation ID is echoed and persisted on authorization audit events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-correlation-id-'))
  const auditPath = path.join(root, 'audit.jsonl')
  const app = createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'viewer-token': { id: 'viewer-1', role: 'Viewer' },
    }),
    repository: {},
    fileStore: {},
    auditLog: new JsonLinesAuditLog(auditPath),
    jobQueue: null,
    importPipeline: {},
    lifecycleService: {},
    topologyService: {},
  })
  let listening = false

  try {
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    listening = true
    const address = app.address()
    const origin = `http://127.0.0.1:${address.port}`
    const suppliedCorrelationId = 'obs-test-123'

    const forbidden = await fetch(`${origin}/api/admin/import-config`, {
      headers: {
        authorization: 'Bearer viewer-token',
        'x-correlation-id': suppliedCorrelationId,
      },
    })
    assert.equal(forbidden.status, 403)
    assert.equal(forbidden.headers.get('x-correlation-id'), suppliedCorrelationId)

    const auditEntries = (await readFile(auditPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const authorizationAudit = auditEntries.find(
      (entry) => entry.event === 'dataset_import.authorization_denied',
    )
    assert.equal(authorizationAudit?.correlationId, suppliedCorrelationId)

    const health = await fetch(`${origin}/health`)
    assert.equal(health.status, 200)
    assert.match(
      health.headers.get('x-correlation-id') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  } finally {
    if (listening) {
      await new Promise((resolve, reject) => {
        app.close((error) => error ? reject(error) : resolve())
      })
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('identity assignment automatically queues topology regeneration', async () => {
  const queued = []
  const auditEntries = []
  const app = createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'admin-token': { id: 'admin-1', role: 'Administrator' },
    }),
    repository: {
      async get() {
        return {
          recordRevision: 4,
          datasetVersion: {
            id: 'dv-identity',
            branchId: 'site-1',
          },
          topologyGeneratedAt: '2026-08-12T00:00:00.000Z',
          topologyGraph: { graphRevision: 'topology-graph:1' },
        }
      },
    },
    fileStore: {},
    auditLog: {
      async record(event, details) {
        const entry = { id: `audit-${auditEntries.length + 1}`, event, ...details }
        auditEntries.push(entry)
        return entry
      },
    },
    jobQueue: {
      async enqueue(input) {
        queued.push(input)
        return {
          jobId: 'job-regenerate-identity',
          jobType: input.jobType,
          deduplicated: false,
        }
      },
      async getPublic(jobId) {
        return { jobId, status: 'queued' }
      },
    },
    importPipeline: {},
    lifecycleService: {
      async assignIdentityAssignments() {
        return {
          datasetVersionId: 'dv-identity',
          recordRevision: 5,
          state: 'updated',
          auditEventId: 'audit-identity-assignment',
        }
      },
    },
    topologyService: {
      async regenerate() {},
    },
  })
  let listening = false
  try {
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    listening = true
    const address = app.address()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/admin/imports/dv-identity/identity-assignments`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
          'idempotency-key': 'identity-assignment-1',
        },
        body: JSON.stringify({ assignments: [{ sourceFeatureId: 'sf-1' }] }),
      },
    )
    const body = await response.json()
    assert.equal(response.status, 202)
    assert.equal(body.topologyRegeneration.status, 'queued')
    assert.equal(body.topologyRegeneration.job.jobId, 'job-regenerate-identity')
    assert.equal(queued[0].jobType, 'regenerate_full_topology')
    assert.equal(queued[0].payload.trigger, 'identity_assignment')
    assert.ok(auditEntries.some(({ event }) => event === 'topology.regeneration_queued'))
  } finally {
    if (listening) {
      await new Promise((resolve, reject) => {
        app.close((error) => error ? reject(error) : resolve())
      })
    }
  }
})
