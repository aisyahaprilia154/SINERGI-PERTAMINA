import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyArtifacts,
  TopologyService,
} from '../src/topology/topology-service.js'
import { generateRelationArtifacts } from '../src/topology/semantic-relation-engine.js'
import { createBaselineTopologyBundle } from './fixtures/topology-baseline-fixture.js'

class MemoryRepository {
  constructor(record) {
    this.record = structuredClone(record)
  }

  async get() {
    return structuredClone(this.record)
  }

  async update(id, updater, { expectedRevision } = {}) {
    const currentRevision = Number(this.record.recordRevision ?? 0)
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      const error = new Error('stale')
      error.code = 'dataset_version_stale_revision'
      throw error
    }
    this.record = await updater(structuredClone(this.record))
    this.record.recordRevision = currentRevision + 1
    return structuredClone(this.record)
  }
}

class MemoryAuditLog {
  constructor() {
    this.entries = []
  }

  async record(event, value) {
    const entry = { id: `audit-${this.entries.length + 1}`, event, ...value }
    this.entries.push(entry)
    return entry
  }
}

function recordFor(bundle) {
  return applyArtifacts({
    datasetVersion: {
      id: bundle.datasetVersion.id,
      datasetId: 'dataset-baseline',
      branchId: 'site-baseline',
      summary: {},
    },
    topologyInputBundle: structuredClone(bundle),
    readiness: {},
    recordRevision: 0,
  }, generateRelationArtifacts(bundle))
}

test('passing shadow publishes atomically and archives the previous graph', async () => {
  const bundle = createBaselineTopologyBundle()
  const repository = new MemoryRepository(recordFor(bundle))
  const before = await repository.get(bundle.datasetVersion.id)
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
    config: { automaticRelationConfirmation: true },
  })

  const published = await service.regenerateShadow(bundle.datasetVersion.id, 'system', {
    reason: 'autonomous test',
  })

  assert.equal(published.topologyShadowRuns.at(-1).status, 'published')
  assert.equal(published.topologyShadowRuns.at(-1).gate.passed, true)
  assert.equal(published.topologyPublication.activeGraphRevision, published.topologyGraph.graphRevision)
  assert.ok(published.topologyGraphHistory.some(({ graphRevision }) => (
    graphRevision === before.topologyGraph.graphRevision
  )))
})

test('failed shadow preserves active graph and records blocking diagnostics', async () => {
  const bundle = createBaselineTopologyBundle()
  bundle.classifiedNodes[0].topologyRequired = true
  bundle.classifiedNodes[0].connectivityExpectation = 'required'
  const repository = new MemoryRepository(recordFor(bundle))
  const before = await repository.get(bundle.datasetVersion.id)
  const service = new TopologyService({
    repository,
    auditLog: new MemoryAuditLog(),
    config: { automaticRelationConfirmation: true },
  })

  const result = await service.regenerateShadow(bundle.datasetVersion.id, 'system')

  assert.deepEqual(result.topologyGraph, before.topologyGraph)
  assert.equal(result.topologyShadowRuns.at(-1).status, 'failed')
  assert.ok(result.topologyShadowRuns.at(-1).gate.blockingCodes.includes('accuracy'))
  assert.ok(result.topologyShadowRuns.at(-1).gate.blockingCodes.includes('required_root_path'))
})

test('manual shadow publication rejects a stale active graph revision', async () => {
  const bundle = createBaselineTopologyBundle()
  const repository = new MemoryRepository(recordFor(bundle))
  const service = new TopologyService({ repository, auditLog: new MemoryAuditLog() })
  const staged = await service.regenerateShadow(bundle.datasetVersion.id, 'system', {
    autoPublish: false,
  })
  const run = staged.topologyShadowRuns.at(-1)
  await repository.update(bundle.datasetVersion.id, (record) => ({
    ...record,
    topologyGraph: { ...record.topologyGraph, graphRevision: 'topology-graph:concurrent' },
  }))

  await assert.rejects(
    service.publishGenerationRun(bundle.datasetVersion.id, run.runId, 'admin'),
    (error) => error.code === 'topology_graph_stale_revision',
  )
})
