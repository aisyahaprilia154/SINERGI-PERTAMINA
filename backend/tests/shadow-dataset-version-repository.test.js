import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareDatasetRecords,
  ShadowDatasetVersionRepository,
} from '../src/storage/shadow-dataset-version-repository.js'

test('shadow read returns primary data and reports candidate, relation, graph, and unresolved mismatches', async () => {
  const primary = new MemoryRepository([datasetRecord('dv-shadow')])
  const shadowRecord = datasetRecord('dv-shadow', {
    topologyCandidates: [{
      ...candidate(),
      score: 0.61,
    }],
    confirmedRelations: [{
      ...relation(),
      targetAssetId: 'device-c',
    }],
    topologyGraph: {
      ...datasetRecord('dv-shadow').topologyGraph,
      components: [{ componentId: 'component-2', nodeIds: ['device-a'], edgeIds: [] }],
    },
    topologyUnresolved: [{ unresolvedId: 'unresolved-2', reason: 'target_missing' }],
  })
  const shadowStore = new MemoryRepository([shadowRecord])
  const reports = []
  const repository = new ShadowDatasetVersionRepository({
    primaryRepository: primary,
    shadowRepository: shadowStore,
    reporter: (report) => reports.push(report),
    clock: () => new Date('2026-08-04T06:00:00.000Z'),
  })

  const result = await repository.get('dv-shadow')
  assert.deepEqual(result, await primary.get('dv-shadow'))
  const report = repository.getLastComparison('dv-shadow')
  assert.equal(report.equal, false)
  assert.deepEqual(
    report.mismatches.map(({ section }) => section).sort(),
    ['confirmedRelations', 'topologyCandidates', 'topologyGraph', 'topologyUnresolved'],
  )
  assert.equal(report.sourceOfTruth, 'primary')
  assert.deepEqual(report.publication, {
    attempted: false,
    published: false,
    shadowWrites: 0,
  })
  assert.equal(reports.length, 1)
  assert.equal(reports[0].comparedAt, '2026-08-04T06:00:00.000Z')

  await repository.update('dv-shadow', (record) => record)
  await repository.activateVersionAtomically({ datasetVersionId: 'dv-shadow' })
  assert.equal(primary.writeCount, 2)
  assert.equal(shadowStore.writeCount, 0)
})

test('shadow comparison is deterministic when database reads return different row order', async () => {
  const primaryRecord = datasetRecord('dv-order')
  const shadowRecord = datasetRecord('dv-order', {
    sourceFeatures: [...primaryRecord.sourceFeatures].reverse(),
    topologyCandidates: [...primaryRecord.topologyCandidates].reverse(),
    confirmedRelations: [...primaryRecord.confirmedRelations].reverse(),
    topologyGraph: {
      ...primaryRecord.topologyGraph,
      nodes: [...primaryRecord.topologyGraph.nodes].reverse(),
      edges: [...primaryRecord.topologyGraph.edges].reverse(),
      components: [...primaryRecord.topologyGraph.components].reverse(),
    },
  })
  assert.equal(compareDatasetRecords(primaryRecord, shadowRecord).equal, true)

  const repository = new ShadowDatasetVersionRepository({
    primaryRepository: new MemoryRepository([primaryRecord]),
    shadowRepository: new MemoryRepository([shadowRecord]),
  })
  await repository.get('dv-order')
  assert.equal(repository.getLastComparison('dv-order').equal, true)
})

test('shadow read failure is fail-open for the primary result and remains observable', async () => {
  const primaryRecord = datasetRecord('dv-available')
  const repository = new ShadowDatasetVersionRepository({
    primaryRepository: new MemoryRepository([primaryRecord]),
    shadowRepository: new FailingShadowRepository(),
  })

  const result = await repository.get('dv-available')
  assert.deepEqual(result, primaryRecord)
  const report = repository.getLastComparison('dv-available')
  assert.equal(report.equal, false)
  assert.equal(report.shadow.available, false)
  assert.equal(report.shadow.errorCode, 'database_schema_not_ready')
  assert.equal(report.mismatches[0].code, 'shadow_read_failed')
})

test('list and active-version reads compare without changing the publication pointer', async () => {
  const primaryRecord = datasetRecord('dv-active')
  const shadowRecord = datasetRecord('dv-active')
  primaryRecord.datasetVersion.status = 'active'
  shadowRecord.datasetVersion.status = 'active'
  const primary = new MemoryRepository([primaryRecord])
  const shadowStore = new MemoryRepository([shadowRecord])
  shadowStore.pointerRevision = primary.pointerRevision
  const repository = new ShadowDatasetVersionRepository({
    primaryRepository: primary,
    shadowRepository: shadowStore,
  })

  const listed = await repository.list()
  assert.deepEqual(listed, [primaryRecord])
  assert.equal(repository.getLastComparison().operation, 'list')
  const resolved = await repository.resolveActiveVersion({
    datasetId: 'dataset-shadow',
    branchId: 'branch-a',
  })
  assert.equal(resolved.record.datasetVersion.id, 'dv-active')
  assert.equal(repository.getLastComparison().operation, 'resolveActiveVersion')
  assert.equal(repository.getLastComparison().equal, true)
  assert.equal(primary.pointerRevision, 'primary-revision')
  assert.equal(shadowStore.pointerRevision, 'primary-revision')
  assert.equal(shadowStore.writeCount, 0)

  const emptyRepository = new ShadowDatasetVersionRepository({
    primaryRepository: new MemoryRepository([]),
    shadowRepository: new MemoryRepository([]),
  })
  assert.equal(await emptyRepository.resolveActiveVersion({
    datasetId: 'dataset-shadow',
    branchId: 'branch-a',
  }), null)
  assert.equal(emptyRepository.getLastComparison().equal, true)
})

test('shadow reports are bounded and repository contracts are validated', async () => {
  assert.throws(
    () => new ShadowDatasetVersionRepository({
      primaryRepository: {},
      shadowRepository: new MemoryRepository([]),
    }),
    /primaryRepository\.get\(\) wajib tersedia/,
  )

  const repository = new ShadowDatasetVersionRepository({
    primaryRepository: new MemoryRepository([datasetRecord('dv-1')]),
    shadowRepository: new MemoryRepository([datasetRecord('dv-1')]),
    maxRetainedReports: 1,
  })
  await repository.get('dv-1')
  await repository.list()
  assert.equal(repository.listComparisons().length, 1)
  repository.clearComparisons()
  assert.deepEqual(repository.listComparisons(), [])
})

function datasetRecord(id, overrides = {}) {
  const record = {
    contractVersion: '1.0.0',
    datasetVersion: {
      id,
      datasetId: 'dataset-shadow',
      branchId: 'branch-a',
      status: 'valid',
      publicationStatus: 'unpublished',
    },
    sourceFeatures: [
      { sourceFeatureId: 'feature-b', name: 'B' },
      { sourceFeatureId: 'feature-a', name: 'A' },
    ],
    topologyCandidates: [candidate()],
    confirmedRelations: [relation()],
    topologyGraph: {
      graphRevision: 'graph-1',
      nodes: [
        { id: 'device-b', assetId: 'device-b' },
        { id: 'device-a', assetId: 'device-a' },
      ],
      edges: [
        { id: 'edge-1', sourceNodeId: 'device-a', targetNodeId: 'device-b' },
      ],
      components: [
        { componentId: 'component-1', nodeIds: ['device-a', 'device-b'], edgeIds: ['edge-1'] },
      ],
      isolatedNodeIds: [],
    },
    topologyUnresolved: [{ unresolvedId: 'unresolved-1', reason: 'ambiguous' }],
    ...overrides,
  }
  return record
}

function candidate() {
  return {
    candidateId: 'candidate-1',
    candidateStatus: 'candidate',
    score: 0.8,
  }
}

function relation() {
  return {
    relationId: 'relation-1',
    sourceAssetId: 'device-a',
    targetAssetId: 'device-b',
    verificationStatus: 'confirmed',
  }
}

class MemoryRepository {
  constructor(records) {
    this.records = new Map(records.map((record) => [record.datasetVersion.id, record]))
    this.writeCount = 0
    this.pointerRevision = 'primary-revision'
  }

  async get(id) {
    const record = this.records.get(id)
    if (!record) {
      throw Object.assign(new Error('missing record'), {
        code: 'dataset_version_not_found',
      })
    }
    return structuredClone(record)
  }

  async list() {
    return structuredClone([...this.records.values()])
  }

  async findActive(datasetId, { excludeId } = {}) {
    const record = [...this.records.values()].find(({ datasetVersion }) => (
      datasetVersion.datasetId === datasetId
        && datasetVersion.status === 'active'
        && datasetVersion.id !== excludeId
    ))
    return record ? structuredClone(record) : null
  }

  async resolveActiveVersion({ datasetId, branchId } = {}) {
    const record = await this.findActive(datasetId, { branchId })
    return record
      ? {
        pointer: {
          datasetId,
          branchId,
          datasetVersionId: record.datasetVersion.id,
          revision: this.pointerRevision,
        },
        record,
      }
      : null
  }

  async update(id, updater) {
    this.writeCount += 1
    const current = await this.get(id)
    const next = await updater(current)
    this.records.set(id, structuredClone(next))
    return structuredClone(next)
  }

  async activateVersionAtomically() {
    this.writeCount += 1
    return { pointer: { revision: this.pointerRevision } }
  }
}

class FailingShadowRepository extends MemoryRepository {
  constructor() {
    super([])
  }

  async get() {
    throw Object.assign(new Error('database unavailable'), {
      code: 'database_schema_not_ready',
    })
  }
}
