import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { DurableJobQueue } from '../src/jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from '../src/jobs/durable-job-repository.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { JsonLinesAuditLog } from '../src/storage/audit-log.js'

test('durable job API exposes safe progress and supports Administrator cancel/retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-job-api-'))
  const repository = new JsonDurableJobRepository(path.join(root, 'jobs'))
  const queue = new DurableJobQueue({ repository, workerId: 'api-test-worker' })
  const auditLog = new JsonLinesAuditLog(path.join(root, 'audit.jsonl'))
  const app = createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'admin-token': { id: 'admin-1', role: 'Administrator' },
      'viewer-token': { id: 'viewer-1', role: 'Viewer' },
    }),
    repository: {},
    fileStore: {},
    auditLog,
    jobQueue: queue,
    importPipeline: {},
    lifecycleService: {},
    topologyService: {},
  })

  try {
    const created = await repository.create({
      jobType: 'operator-test',
      datasetVersionId: 'dv-api-test',
      inputFingerprint: 'sha256:api',
      payload: { sourceStorageKey: 'source-files/private.kml', secretToken: 'must-not-leak' },
    })
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
    const address = app.address()
    const origin = `http://127.0.0.1:${address.port}`

    const forbidden = await fetch(`${origin}/api/admin/jobs/${created.jobId}`, {
      headers: { authorization: 'Bearer viewer-token' },
    })
    assert.equal(forbidden.status, 403)

    const visible = await fetch(`${origin}/api/admin/jobs/${created.jobId}`, {
      headers: { authorization: 'Bearer admin-token' },
    })
    const visibleBody = await visible.json()
    assert.equal(visible.status, 200)
    assert.equal(visibleBody.job.jobId, created.jobId)
    assert.equal(Object.hasOwn(visibleBody.job, 'payload'), false)
    assert.equal(JSON.stringify(visibleBody).includes('source-files'), false)

    const cancelled = await fetch(`${origin}/api/admin/jobs/${created.jobId}/cancel`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
    })
    assert.equal(cancelled.status, 200)
    assert.equal((await cancelled.json()).job.status, 'cancelled')

    const retried = await fetch(`${origin}/api/admin/jobs/${created.jobId}/retry`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
    })
    assert.equal(retried.status, 200)
    assert.equal((await retried.json()).job.status, 'queued')

    await new Promise((resolve, reject) => {
      app.close((error) => error ? reject(error) : resolve())
    })
  } finally {
    await queue.stop()
    await rm(root, { recursive: true, force: true })
  }
})
