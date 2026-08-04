import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import {
  generateRelationArtifacts,
  rebuildConfirmedRelationArtifacts,
} from '../src/topology/semantic-relation-engine.js'
import { applyArtifacts, TopologyService } from '../src/topology/topology-service.js'

test('review rebuild matches full regeneration without rediscovering candidates', () => {
  const bundle = reviewBundle({ includeIsolatedNode: true })
  const generatedAt = '2026-08-04T04:00:00.000Z'
  const initial = generateRelationArtifacts(bundle, { generatedAt })
  const candidates = structuredClone(initial.candidates)
  const reviewed = candidates.filter(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
      || sourceEndpointId === 'endpoint:geometry:CBL-01:end'
  ))
  reviewed.forEach((candidate) => {
    candidate.candidateStatus = 'confirmed'
    candidate.proposalStatus = 'confirmed_by_admin'
    candidate.review = {
      actorId: 'admin-1',
      reviewedAt: generatedAt,
      reason: 'Review hardening test.',
      action: 'confirm',
      auditEventId: `audit:${candidate.candidateId}`,
      before: 'candidate',
      after: 'confirmed',
    }
  })

  const full = generateRelationArtifacts(bundle, {
    previousCandidates: candidates,
    previousRelations: initial.confirmedRelations,
    generatedAt,
  })
  const incremental = rebuildConfirmedRelationArtifacts(bundle, {
    candidates,
    previousRelations: initial.confirmedRelations,
    previousGraph: initial.graph,
    affectedAssetIds: reviewed.flatMap(candidateAssetReferences),
    eligibilityIssues: initial.eligibilityIssues,
    lineworkIssues: initial.lineworkIssues,
    generatedAt,
  })

  assert.deepEqual(incremental.graph, full.graph)
  assert.deepEqual(incremental.confirmedRelations, full.confirmedRelations)
  assert.deepEqual(incremental.validation, full.validation)
  assert.deepEqual(incremental.summary, full.summary)
  assert.deepEqual(incremental.readiness, full.readiness)
})

test('JSON review updates serialize different candidates without lost updates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-review-hardening-'))
  try {
    const bundle = reviewBundle()
    const initial = generateRelationArtifacts(bundle)
    const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
    await repository.create(applyArtifacts(baseRecord(bundle), initial))
    const auditLog = new MemoryAuditLog()
    const firstService = new TopologyService({ repository, auditLog })
    const secondService = new TopologyService({ repository, auditLog })
    const startCandidate = initial.candidates.find(({ sourceEndpointId }) => (
      sourceEndpointId === 'endpoint:geometry:CBL-01:start'
    ))
    const endCandidate = initial.candidates.find(({ sourceEndpointId }) => (
      sourceEndpointId === 'endpoint:geometry:CBL-01:end'
    ))

    const results = await Promise.all([
      firstService.confirmCandidate(startCandidate.candidateId, 'admin-1', {
        reason: 'Reviewer pertama menyetujui endpoint awal.',
      }),
      secondService.confirmCandidate(endCandidate.candidateId, 'admin-2', {
        reason: 'Reviewer kedua menyetujui endpoint akhir.',
      }),
    ])
    assert.equal(results.length, 2)
    const persisted = await repository.get(bundle.datasetVersion.id)
    assert.equal(persisted.recordRevision, 2)
    assert.equal(
      persisted.topologyCandidates.filter(({ candidateStatus }) => candidateStatus === 'confirmed')
        .length,
      2,
    )
    assert.equal(persisted.topologyGraph.edges.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('two reviewers on the same candidate produce one winner and a 409 conflict', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-review-conflict-'))
  try {
    const bundle = reviewBundle()
    const initial = generateRelationArtifacts(bundle)
    const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
    await repository.create(applyArtifacts(baseRecord(bundle), initial))
    const auditLog = new MemoryAuditLog()
    const firstService = new TopologyService({ repository, auditLog })
    const secondService = new TopologyService({ repository, auditLog })
    const candidate = initial.candidates.find(({ sourceEndpointId }) => (
      sourceEndpointId === 'endpoint:geometry:CBL-01:start'
    ))

    const results = await Promise.allSettled([
      firstService.confirmCandidate(candidate.candidateId, 'admin-1', {
        reason: 'Reviewer pertama menyetujui kandidat.',
      }),
      secondService.confirmCandidate(candidate.candidateId, 'admin-2', {
        reason: 'Reviewer kedua menyetujui kandidat.',
      }),
    ])
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
    const rejected = results.find(({ status }) => status === 'rejected')
    assert.equal(rejected.reason.statusCode, 409)
    const persisted = await repository.get(bundle.datasetVersion.id)
    assert.equal(
      persisted.topologyCandidates.filter(({ candidateStatus }) => candidateStatus === 'confirmed')
        .length,
      1,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('HTTP review accepts graph and candidate revisions emitted by the candidate API', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-review-http-revision-'))
  try {
    const bundle = reviewBundle()
    const initial = generateRelationArtifacts(bundle)
    const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
    await repository.create(applyArtifacts(baseRecord(bundle), initial))
    const auditLog = new MemoryAuditLog()
    const topologyService = new TopologyService({ repository, auditLog })
    const app = createApp({
      config: {},
      authenticator: new TokenAuthenticator({
        'admin-token': { id: 'admin-1', role: 'Administrator' },
      }),
      repository,
      fileStore: {},
      auditLog,
      jobQueue: {},
      importPipeline: {},
      lifecycleService: {},
      topologyService,
    })
    await listen(app)
    const origin = `http://127.0.0.1:${app.address().port}`

    try {
      const candidatesResponse = await fetch(
        `${origin}/api/dataset-versions/${bundle.datasetVersion.id}/topology/candidates`,
        { headers: { authorization: 'Bearer admin-token' } },
      )
      const candidatesBody = await candidatesResponse.json()
      assert.equal(candidatesResponse.status, 200)
      const candidate = candidatesBody.items.find(({ candidateStatus }) => (
        candidateStatus === 'candidate'
      ))
      assert.ok(candidate)

      const reviewResponse = await fetch(
        `${origin}/api/topology/candidates/${encodeURIComponent(candidate.candidateId)}/confirm`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer admin-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            reason: 'HTTP graph revision contract test.',
            expectedGraphRevision: candidatesBody.graphRevision,
            expectedCandidateRevision: candidatesBody.candidateRevision,
          }),
        },
      )
      assert.equal(reviewResponse.status, 200)
      const reviewBody = await reviewResponse.json()
      assert.equal(reviewBody.candidate.candidateStatus, 'confirmed')
      assert.notEqual(reviewBody.graphRevision, candidatesBody.graphRevision)
      assert.notEqual(reviewBody.candidateRevision, candidatesBody.candidateRevision)
    } finally {
      await close(app)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('HTTP review retry with the same idempotency key replays one committed result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-review-idempotency-'))
  try {
    const bundle = reviewBundle()
    const initial = generateRelationArtifacts(bundle)
    const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
    await repository.create(applyArtifacts(baseRecord(bundle), initial))
    const auditLog = new MemoryAuditLog()
    const topologyService = new TopologyService({ repository, auditLog })
    const app = createApp({
      config: {},
      authenticator: new TokenAuthenticator({
        'admin-token': { id: 'admin-1', role: 'Administrator' },
      }),
      repository,
      fileStore: {},
      auditLog,
      jobQueue: {},
      importPipeline: {},
      lifecycleService: {},
      topologyService,
    })
    await listen(app)
    const origin = `http://127.0.0.1:${app.address().port}`
    const idempotencyKey = 'review-retry-2026-08-04-001'

    try {
      const candidate = initial.candidates.find(({ sourceEndpointId }) => (
        sourceEndpointId === 'endpoint:geometry:CBL-01:start'
      ))
      const endpoint = `${origin}/api/topology/candidates/${encodeURIComponent(candidate.candidateId)}/confirm`
      const request = {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ reason: 'Retry idempotency contract test.' }),
      }

      const firstResponse = await fetch(endpoint, request)
      const firstBody = await firstResponse.json()
      const retryResponse = await fetch(endpoint, request)
      const retryBody = await retryResponse.json()
      assert.equal(firstResponse.status, 200)
      assert.equal(retryResponse.status, 200)
      assert.deepEqual(retryBody, firstBody)

      const persisted = await repository.get(bundle.datasetVersion.id)
      assert.equal(auditLog.index, 1)
      assert.equal(persisted.recordRevision, 1)
      assert.equal(
        persisted.confirmedRelations.filter(({ verificationStatus }) => (
          verificationStatus === 'confirmed'
        )).length,
        1,
      )
      assert.equal(persisted.topologyMutationReceipts.length, 1)
      assert.equal(persisted.topologyMutationReceipts[0].key, idempotencyKey)

      const reusedResponse = await fetch(endpoint, {
        ...request,
        body: JSON.stringify({ reason: 'Same key, different mutation.' }),
      })
      const reusedBody = await reusedResponse.json()
      assert.equal(reusedResponse.status, 409)
      assert.equal(reusedBody.error.code, 'idempotency_key_reused')
      assert.equal(auditLog.index, 1)
    } finally {
      await close(app)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent HTTP review retry with the same idempotency key commits once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-review-concurrent-idempotency-'))
  try {
    const bundle = reviewBundle()
    const initial = generateRelationArtifacts(bundle)
    const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
    await repository.create(applyArtifacts(baseRecord(bundle), initial))
    let releaseFirstAudit
    let firstAuditStartedResolve
    const firstAuditStarted = new Promise((resolve) => {
      firstAuditStartedResolve = resolve
    })
    const auditLog = new MemoryAuditLog({
      beforeRecord: async ({ index }) => {
        if (index !== 1) return
        releaseFirstAudit = () => {}
        await new Promise((resolve) => {
          releaseFirstAudit = resolve
          firstAuditStartedResolve()
        })
      },
    })
    const originalUpdate = repository.update.bind(repository)
    let updateCalls = 0
    let secondUpdateStartedResolve
    const secondUpdateStarted = new Promise((resolve) => {
      secondUpdateStartedResolve = resolve
    })
    repository.update = async (...args) => {
      updateCalls += 1
      if (updateCalls === 2) secondUpdateStartedResolve()
      return originalUpdate(...args)
    }
    const topologyService = new TopologyService({ repository, auditLog })
    const app = createApp({
      config: {},
      authenticator: new TokenAuthenticator({
        'admin-token': { id: 'admin-1', role: 'Administrator' },
      }),
      repository,
      fileStore: {},
      auditLog,
      jobQueue: {},
      importPipeline: {},
      lifecycleService: {},
      topologyService,
    })
    await listen(app)
    const origin = `http://127.0.0.1:${app.address().port}`
    const idempotencyKey = 'review-concurrent-retry-2026-08-04-001'
    const candidate = initial.candidates.find(({ sourceEndpointId }) => (
      sourceEndpointId === 'endpoint:geometry:CBL-01:start'
    ))
    const endpoint = `${origin}/api/topology/candidates/${encodeURIComponent(candidate.candidateId)}/confirm`
    const makeRequest = () => ({
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ reason: 'Concurrent retry idempotency contract test.' }),
    })

    try {
      const responsesPromise = Promise.all([
        fetch(endpoint, makeRequest()),
        fetch(endpoint, makeRequest()),
      ])
      await firstAuditStarted
      await secondUpdateStarted
      releaseFirstAudit()
      const [firstResponse, secondResponse] = await responsesPromise
      const firstBody = await firstResponse.json()
      const secondBody = await secondResponse.json()
      assert.equal(firstResponse.status, 200)
      assert.equal(secondResponse.status, 200)
      assert.deepEqual(secondBody, firstBody)
      assert.equal(updateCalls, 2)

      const persisted = await repository.get(bundle.datasetVersion.id)
      assert.equal(auditLog.index, 1)
      assert.equal(persisted.recordRevision, 1)
      assert.equal(
        persisted.confirmedRelations.filter(({ verificationStatus }) => (
          verificationStatus === 'confirmed'
        )).length,
        1,
      )
      assert.equal(persisted.topologyMutationReceipts.length, 1)
    } finally {
      await close(app)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('HTTP review rolls back state and audit when the transactional write fails', async () => {
  const bundle = reviewBundle()
  const initial = generateRelationArtifacts(bundle)
  const repository = new TransactionalMemoryRepository([
    applyArtifacts(baseRecord(bundle), initial),
  ])
  const auditLog = new TransactionalMemoryAuditLog()
  const topologyService = new TopologyService({ repository, auditLog })
  const app = createApp({
    config: {},
    authenticator: new TokenAuthenticator({
      'admin-token': { id: 'admin-1', role: 'Administrator' },
    }),
    repository,
    fileStore: {},
    auditLog,
    jobQueue: {},
    importPipeline: {},
    lifecycleService: {},
    topologyService,
  })
  await listen(app)
  const origin = `http://127.0.0.1:${app.address().port}`
  const candidate = initial.candidates.find(({ sourceEndpointId }) => (
    sourceEndpointId === 'endpoint:geometry:CBL-01:start'
  ))
  const endpoint = `${origin}/api/topology/candidates/${encodeURIComponent(candidate.candidateId)}/confirm`
  const request = {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Audit transaction failure injection.' }),
  }

  try {
    repository.failAfterUpdate = Object.assign(new Error('injected review write failure'), {
      code: 'injected_review_write_failure',
    })
    const failed = await fetch(endpoint, request)
    assert.equal(failed.status, 500)

    const rolledBack = await repository.get(bundle.datasetVersion.id)
    assert.equal(
      rolledBack.topologyCandidates.find(({ candidateId }) => (
        candidateId === candidate.candidateId
      )).candidateStatus,
      'candidate',
    )
    assert.equal(auditLog.entries.length, 0)
    assert.equal(repository.transactionCount, 1)

    const succeeded = await fetch(endpoint, request)
    assert.equal(succeeded.status, 200)
    const committed = await repository.get(bundle.datasetVersion.id)
    const committedCandidate = committed.topologyCandidates.find(({ candidateId }) => (
      candidateId === candidate.candidateId
    ))
    assert.equal(committedCandidate.candidateStatus, 'confirmed')
    assert.equal(auditLog.entries.length, 1)
    assert.equal(committedCandidate.review.auditEventId, auditLog.entries[0].id)
  } finally {
    await close(app)
  }
})

test('repository expected revision rejects a stale aggregate writer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-record-revision-'))
  try {
    const repository = new JsonDatasetVersionRepository(path.join(root, 'dataset-versions'))
    await repository.create({ datasetVersion: { id: 'dv-revision' }, value: 'initial' })
    const snapshot = await repository.get('dv-revision')
    const updated = await repository.update('dv-revision', {
      value: 'first-writer',
    }, { expectedRevision: 0 })
    assert.equal(updated.recordRevision, 1)
    await assert.rejects(
      repository.update('dv-revision', { value: 'stale-writer' }, {
        expectedRevision: snapshot.recordRevision ?? 0,
      }),
      (error) => error.code === 'dataset_version_stale_revision'
        && error.details.currentRevision === 1,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function reviewBundle({ includeIsolatedNode = false } = {}) {
  const nodes = [
    nodeRecord('CAM-01', [110.00001, -7]),
    nodeRecord('CAM-END', [110.001, -7]),
    ...(includeIsolatedNode ? [nodeRecord('CAM-ISOLATED', [110.01, -7])] : []),
  ]
  const pathRecordValue = pathRecord('CBL-01', [[110, -7], [110.001, -7]])
  return {
    datasetVersion: {
      id: 'dv-review-hardening',
      sourceChecksum: `sha256:${'c'.repeat(64)}`,
    },
    site: 'site-1',
    classifiedNodes: nodes.map(({ object }) => object),
    classifiedPaths: [pathRecordValue.object],
    geometries: [...nodes.map(({ geometry }) => geometry), pathRecordValue.geometry],
    explicitRelations: [],
    semanticRuleSetVersion: 'semantic-classifier/1.0.0',
  }
}

function nodeRecord(assetId, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-1',
      objectRole: 'device_node',
      networkFamily: 'cctv',
      assetType: 'CCTV Camera',
      category: 'CCTV',
      classificationStatus: 'classified',
      classificationEvidence: [],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-review-hardening',
      sourceFeatureId,
      geometryType: 'Point',
      coordinates,
      valid: true,
    },
  }
}

function pathRecord(assetId, coordinates) {
  const sourceFeatureId = `feature:${assetId}`
  const geometryId = `geometry:${assetId}`
  return {
    object: {
      assetId,
      sourceFeatureId,
      siteId: 'site-1',
      objectRole: 'cable_path',
      networkFamily: 'cctv',
      assetType: 'CCTV Cable',
      category: 'CCTV Cable',
      classificationStatus: 'classified',
      classificationEvidence: [],
      geometryIds: [geometryId],
    },
    geometry: {
      geometryId,
      datasetVersionId: 'dv-review-hardening',
      sourceFeatureId,
      geometryType: 'LineString',
      coordinates,
      valid: true,
    },
  }
}

function baseRecord(bundle) {
  return {
    datasetVersion: {
      id: bundle.datasetVersion.id,
      datasetId: 'dataset-review-hardening',
      branchId: 'site-1',
    },
    topologyInputBundle: structuredClone(bundle),
    relations: [],
    readiness: {},
  }
}

function candidateAssetReferences(candidate) {
  return [
    candidate.sourcePathAssetId,
    candidate.targetAssetId,
    candidate.targetPathAssetId,
    ...(candidate.sourceGeometryIds ?? []),
  ].filter(Boolean)
}

class MemoryAuditLog {
  constructor({ beforeRecord = null } = {}) {
    this.index = 0
    this.beforeRecord = beforeRecord
  }

  async record(event, input) {
    this.index += 1
    await this.beforeRecord?.({ index: this.index, event })
    return { id: `audit-${this.index}`, event, ...structuredClone(input) }
  }
}

class TransactionalMemoryRepository {
  constructor(records) {
    this.records = new Map(records.map((record) => [record.datasetVersion.id, record]))
    this.transactionCount = 0
    this.failAfterUpdate = null
  }

  async get(id) {
    const record = this.records.get(id)
    if (!record) throw new Error(`missing record ${id}`)
    return structuredClone(record)
  }

  async list() {
    return [...this.records.values()].map((record) => structuredClone(record))
  }

  async update(id, updater, { expectedRevision } = {}) {
    const current = await this.get(id)
    const currentRevision = Number.isInteger(current.recordRevision)
      ? current.recordRevision
      : 0
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw Object.assign(new Error('stale record'), {
        code: 'dataset_version_stale_revision',
        statusCode: 409,
      })
    }
    const next = typeof updater === 'function'
      ? await updater(structuredClone(current))
      : { ...current, ...updater }
    const normalized = {
      ...next,
      recordRevision: currentRevision + 1,
    }
    this.records.set(id, structuredClone(normalized))
    if (this.failAfterUpdate) {
      const error = this.failAfterUpdate
      this.failAfterUpdate = null
      throw error
    }
    return structuredClone(normalized)
  }

  async withTransaction(operation) {
    this.transactionCount += 1
    const snapshot = new Map([...this.records].map(([id, record]) => (
      [id, structuredClone(record)]
    )))
    const transaction = {
      onCommit: [],
      onRollback: [],
      pendingAuditCount: 0,
    }
    const repository = {
      get: this.get.bind(this),
      list: this.list.bind(this),
      update: this.update.bind(this),
    }
    try {
      const result = await operation({ client: transaction, repository })
      for (const callback of transaction.onCommit) await callback()
      return result
    } catch (error) {
      this.records = snapshot
      for (const callback of transaction.onRollback) await callback()
      throw error
    }
  }
}

class TransactionalMemoryAuditLog {
  constructor() {
    this.entries = []
  }

  async record(event, input) {
    const entry = this.#entry(event, input, this.entries.length + 1)
    this.entries.push(entry)
    return entry
  }

  withExecutor(transaction) {
    return {
      record: async (event, input) => {
        const entry = this.#entry(
          event,
          input,
          this.entries.length + transaction.pendingAuditCount + 1,
        )
        transaction.pendingAuditCount += 1
        transaction.onCommit.push(() => {
          this.entries.push(entry)
        })
        return entry
      },
    }
  }

  #entry(event, input, index) {
    return {
      id: `audit-${index}`,
      event,
      ...structuredClone(input ?? {}),
    }
  }
}

async function listen(app) {
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
}

async function close(app) {
  await new Promise((resolve, reject) => {
    app.close((error) => error ? reject(error) : resolve())
  })
}
