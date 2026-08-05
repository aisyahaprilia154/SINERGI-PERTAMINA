import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { JsonLinesAuditLog } from '../src/storage/audit-log.js'
import { DurableJobQueue } from '../src/jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from '../src/jobs/durable-job-repository.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import {
  applyArtifacts,
  createFullTopologyRegenerationJobHandler,
  TopologyService,
} from '../src/topology/topology-service.js'
import {
  generateRelationArtifacts,
  TOPOLOGY_RULE_SET_VERSION,
} from '../src/topology/semantic-relation-engine.js'
import { createBaselineTopologyBundle } from './fixtures/topology-baseline-fixture.js'

test('full topology regeneration is durable, idempotent, and survives worker replacement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-topology-regeneration-job-'))
  const datasetRepository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
  const auditLog = new JsonLinesAuditLog(path.join(root, 'audit', 'events.jsonl'))
  const jobRoot = path.join(root, 'jobs')
  const bundle = createBaselineTopologyBundle()
  const initial = generateRelationArtifacts(bundle, {
    generatedAt: '2026-08-05T00:00:00.000Z',
  })
  await datasetRepository.create(applyArtifacts({
    datasetVersion: {
      id: bundle.datasetVersion.id,
      datasetId: 'dataset-baseline',
      branchId: 'site-baseline',
      recordRevision: 0,
      summary: {},
    },
    topologyInputBundle: structuredClone(bundle),
    relations: [],
    readiness: {},
  }, initial))

  const topologyService = new TopologyService({
    repository: datasetRepository,
    auditLog,
  })
  const firstQueue = new DurableJobQueue({
    repository: new JsonDurableJobRepository(jobRoot),
    workerId: 'regeneration-request-process',
    pollMilliseconds: 5,
  })
  const app = createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'admin-token': { id: 'admin-1', role: 'Administrator' },
    }),
    repository: datasetRepository,
    fileStore: {},
    auditLog,
    jobQueue: firstQueue,
    importPipeline: {},
    lifecycleService: {},
    topologyService,
  })
  let replacementQueue = null

  try {
    await listen(app)
    const origin = `http://127.0.0.1:${app.address().port}`
    const request = () => fetch(
      `${origin}/api/dataset-versions/${bundle.datasetVersion.id}/topology/regenerate`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
          'idempotency-key': 'regeneration-job-2026-08-05-001',
        },
        body: JSON.stringify({ reason: 'Durable full regeneration contract.' }),
      },
    )

    const [firstResponse, secondResponse] = await Promise.all([request(), request()])
    const firstBody = await firstResponse.json()
    const secondBody = await secondResponse.json()
    assert.deepEqual(
      [firstResponse.status, secondResponse.status].sort((a, b) => a - b),
      [200, 202],
    )
    assert.equal(firstBody.job.jobType, 'regenerate_full_topology')
    assert.equal(firstBody.job.status, 'queued')
    assert.equal(firstBody.statusUrl, `/api/admin/jobs/${firstBody.job.jobId}`)
    assert.equal(secondBody.job.jobId, firstBody.job.jobId)
    assert.equal(secondBody.job.status, 'queued')

    await close(app)
    await firstQueue.stop()

    replacementQueue = new DurableJobQueue({
      repository: new JsonDurableJobRepository(jobRoot),
      workerId: 'regeneration-replacement-worker',
      pollMilliseconds: 5,
    })
    replacementQueue.registerHandler(
      'regenerate_full_topology',
      createFullTopologyRegenerationJobHandler(topologyService),
    )
    await replacementQueue.start()
    const terminal = await waitForTerminalJob(
      replacementQueue,
      firstBody.job.jobId,
    )

    assert.equal(terminal.status, 'succeeded')
    assert.equal(terminal.attemptCount, 1)
    assert.equal(terminal.result.datasetVersionId, bundle.datasetVersion.id)
    assert.equal(terminal.result.topologyRuleSetVersion, TOPOLOGY_RULE_SET_VERSION)
    assert.ok(terminal.result.graphRevision.startsWith('topology-graph:'))
    assert.ok(terminal.result.topologyRunId)

    const persisted = await datasetRepository.get(bundle.datasetVersion.id)
    assert.equal(persisted.recordRevision, 1)
    assert.equal(persisted.topologyRuns.length, 1)
    assert.equal(persisted.topologyRuns[0].runId, terminal.result.topologyRunId)
    assert.equal(persisted.topologyGraph.graphRevision, terminal.result.graphRevision)

    const auditEntries = (await readFile(path.join(root, 'audit', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.ok(auditEntries.some((entry) => entry.event === 'topology.regeneration_queued'))
    const regenerated = auditEntries.find((entry) => (
      entry.event === 'topology.candidates_regenerated'
    ))
    assert.equal(regenerated.details.jobId, firstBody.job.jobId)
  } finally {
    if (app.listening) await close(app)
    await firstQueue.stop()
    if (replacementQueue) await replacementQueue.stop()
    await rm(root, { recursive: true, force: true })
  }
})

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function waitForTerminalJob(queue, jobId) {
  let last = null
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    last = await queue.get(jobId)
    if (['succeeded', 'failed', 'dead_letter', 'cancelled'].includes(last.status)) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Regeneration job timeout: ${JSON.stringify(last)}`)
}
