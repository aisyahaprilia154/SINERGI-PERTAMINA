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
  constructor() {
    this.index = 0
  }

  async record(event, input) {
    this.index += 1
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
