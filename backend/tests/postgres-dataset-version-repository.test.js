import assert from 'node:assert/strict'
import test from 'node:test'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import { PostgresAuditLog } from '../src/storage/postgres-audit-log.js'

test('PostgreSQL adapter preserves aggregate CRUD and writes projections in one transaction', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool, {
    clock: () => new Date('2026-08-04T01:02:03.000Z'),
  })
  const original = datasetRecord('version-a')

  const created = await repository.create(original)
  assert.deepEqual(created, original)
  assert.deepEqual(await repository.get('version-a'), original)
  assert.deepEqual((await repository.list()).map(({ datasetVersion }) => (
    datasetVersion.id
  )), ['version-a'])
  assert.ok(pool.commands.some((command) => command === 'BEGIN'))
  assert.ok(pool.commands.some((command) => command.includes('DELETE FROM topology_candidates')))
  assert.ok(pool.commands.some((command) => command === 'COMMIT'))

  const updated = await repository.update('version-a', (record) => ({
    ...record,
    datasetVersion: {
      ...record.datasetVersion,
      status: 'invalid',
      validationStatus: 'invalid',
    },
  }))
  assert.equal(updated.datasetVersion.status, 'invalid')
  assert.equal((await repository.get('version-a')).datasetVersion.status, 'invalid')
  assert.equal(pool.released, 2)
})

test('PostgreSQL adapter casts GeoJSON parameters before PostGIS conversion', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool)
  const record = datasetRecord('version-geometry')
  record.sourceFeatures = [{ sourceFeatureId: 'feature-1' }]
  record.sourceGeometries = [{
    geometryId: 'geometry-1',
    sourceFeatureId: 'feature-1',
    geometryType: 'LineString',
    coordinates: [[106, -6], [107, -6]],
  }]
  record.topologyGraph = {
    graphRevision: 'graph-1',
    nodes: [{ id: 'node-1', location: [106, -6] }],
    edges: [],
  }

  await repository.create(record)

  const geometryInsert = pool.commands.find((command) => (
    command.includes('INSERT INTO source_geometries')
  ))
  assert.match(geometryInsert, /CASE WHEN \$6::text IS NULL/)
  assert.match(geometryInsert, /ST_GeomFromGeoJSON\(\$6::text\)/)

  const graphNodeInsert = pool.commands.find((command) => (
    command.includes('INSERT INTO graph_nodes')
  ))
  assert.match(graphNodeInsert, /CASE WHEN \$8::text IS NULL/)
  assert.match(graphNodeInsert, /ST_GeomFromGeoJSON\(\$8::text\)/)
})

test('PostgreSQL adapter maps missing, duplicate, and schema errors to application errors', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool)
  await assert.rejects(
    repository.get('missing-version'),
    (error) => error.code === 'dataset_version_not_found' && error.statusCode === 404,
  )

  pool.failInsert = {
    code: '23505',
    constraint: 'dataset_versions_pkey',
  }
  await assert.rejects(
    repository.create(datasetRecord('duplicate-version')),
    (error) => error.code === 'dataset_version_exists' && error.statusCode === 409,
  )
})

test('PostgreSQL adapter rejects a stale aggregate revision inside the row lock', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool)
  await repository.create(datasetRecord('version-revision'))

  const updated = await repository.update('version-revision', (record) => ({
    ...record,
    revisionMarker: 'first-writer',
  }), { expectedRevision: 0 })
  assert.equal(updated.recordRevision, 1)
  await assert.rejects(
    repository.update('version-revision', { revisionMarker: 'stale-writer' }, {
      expectedRevision: 0,
    }),
    (error) => error.code === 'dataset_version_stale_revision'
      && error.details.currentRevision === 1,
  )
})

test('PostgreSQL transaction scope commits aggregate and audit on the same client', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool)
  const auditLog = new PostgresAuditLog(pool, {
    clock: () => new Date('2026-08-04T03:04:05.000Z'),
  })
  await repository.create(datasetRecord('version-transaction'))

  await repository.withTransaction(async ({ client, repository: transactionRepository }) => {
    const current = await transactionRepository.get('version-transaction')
    const event = await auditLog.withExecutor(client).record('topology.reviewed', {
      actorId: 'admin-1',
      datasetVersionId: current.datasetVersion.id,
      outcome: 'confirmed',
      details: { recordRevision: current.recordRevision ?? 0 },
    })
    await transactionRepository.update('version-transaction', (record) => ({
      ...record,
      reviewAuditEventId: event.id,
    }), { expectedRevision: current.recordRevision ?? 0 })
  })

  const persisted = await repository.get('version-transaction')
  assert.equal(persisted.reviewAuditEventId, pool.auditEvents[0].event_id)
  assert.equal(pool.auditEvents.length, 1)
  assert.ok(pool.commands.includes('BEGIN'))
  assert.ok(pool.commands.includes('COMMIT'))
})

test('PostgreSQL transaction scope rolls back aggregate and audit together', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool)
  const auditLog = new PostgresAuditLog(pool)
  await repository.create(datasetRecord('version-transaction-rollback'))
  pool.failAudit = Object.assign(new Error('injected audit failure'), {
    code: 'injected_audit_failure',
  })

  await assert.rejects(
    repository.withTransaction(async ({ client, repository: transactionRepository }) => {
      const current = await transactionRepository.get('version-transaction-rollback')
      const event = await auditLog.withExecutor(client).record('topology.reviewed', {
        actorId: 'admin-1',
        datasetVersionId: current.datasetVersion.id,
      })
      await transactionRepository.update('version-transaction-rollback', {
        reviewAuditEventId: event.id,
      })
    }),
    (error) => error.code === 'injected_audit_failure',
  )

  const persisted = await repository.get('version-transaction-rollback')
  assert.equal(persisted.reviewAuditEventId, undefined)
  assert.equal(pool.auditEvents.length, 0)
})

test('PostgreSQL adapter activates one version with a transactional active pointer', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool, {
    clock: () => new Date('2026-08-04T01:02:03.000Z'),
  })
  await repository.create(datasetRecord('version-old', 'active'))
  await repository.create(datasetRecord('version-new', 'valid'))

  const activation = await repository.activateVersionAtomically({
    datasetVersionId: 'version-new',
    actorId: 'admin-1',
    activatedAt: '2026-08-04T02:00:00.000Z',
    expectedActiveVersionId: 'version-old',
    validateTarget(record) {
      assert.equal(record.datasetVersion.id, 'version-new')
    },
  })
  assert.equal(activation.previous.datasetVersion.id, 'version-old')
  assert.equal(activation.activated.datasetVersion.status, 'active')
  assert.equal(activation.pointer.datasetVersionId, 'version-new')
  assert.notEqual(activation.pointer.revision, '')
  assert.equal((await repository.get('version-old')).datasetVersion.status, 'archived')

  const active = await repository.resolveActiveVersion({
    datasetId: 'dataset-1',
    branchId: 'branch-1',
  })
  assert.equal(active.record.datasetVersion.id, 'version-new')
  assert.equal(active.pointer.revision, activation.pointer.revision)
})

test('PostgreSQL adapter rolls activation back after a pre-pointer failure', async () => {
  const pool = new FakePool()
  const repository = new PostgresDatasetVersionRepository(pool)
  await repository.create(datasetRecord('version-old', 'active'))
  await repository.create(datasetRecord('version-new', 'valid'))
  const failingRepository = new PostgresDatasetVersionRepository(pool, {
    activationHooks: {
      async beforePointerCommit() {
        throw Object.assign(new Error('injected pointer failure'), {
          code: 'injected_pointer_failure',
        })
      },
    },
  })

  await assert.rejects(
    failingRepository.activateVersionAtomically({
      datasetVersionId: 'version-new',
      actorId: 'admin-1',
      activatedAt: '2026-08-04T02:00:00.000Z',
      expectedActiveVersionId: 'version-old',
    }),
    (error) => error.code === 'injected_pointer_failure'
      && error.activationContext.previousVersionId === 'version-old',
  )
  assert.equal((await repository.get('version-old')).datasetVersion.status, 'active')
  assert.equal((await repository.get('version-new')).datasetVersion.status, 'valid')
  assert.equal(
    (await repository.resolveActiveVersion({
      datasetId: 'dataset-1',
      branchId: 'branch-1',
    })).record.datasetVersion.id,
    'version-old',
  )
})

function datasetRecord(id, status = 'valid') {
  const active = status === 'active'
  const validationStatus = status === 'invalid' ? 'invalid' : 'valid'
  return {
    contractVersion: '1.0.0',
    datasetVersion: {
      id,
      datasetId: 'dataset-1',
      branchId: 'branch-1',
      versionName: id,
      checksum: `sha256:${id}`,
      validationStatus,
      publicationStatus: active ? 'published' : 'unpublished',
      status,
      summary: {},
    },
    validation: {
      status: validationStatus,
      canActivate: validationStatus === 'valid',
      summary: { errors: validationStatus === 'invalid' ? 1 : 0 },
    },
    layers: [],
    assets: [],
    geometries: [],
    relations: [],
    issues: [],
    sourceFeatures: [],
    sourceGeometries: [],
    classifiedObjects: [],
    topologyCandidates: [],
    confirmedRelations: [],
  }
}

class FakePool {
  constructor() {
    this.records = new Map()
    this.pointers = new Map()
    this.auditEvents = []
    this.commands = []
    this.released = 0
    this.failInsert = null
    this.failAudit = null
  }

  async query(text, values = []) {
    return this.handle(text, values)
  }

  async connect() {
    return new FakeClient(this)
  }

  handle(text, values, client = null) {
    const sql = text.trim().replace(/\s+/g, ' ')
    this.commands.push(text.trim())
    if (sql === 'BEGIN') {
      client?.begin()
      return { rows: [] }
    }
    if (sql === 'COMMIT') {
      client?.commit()
      return { rows: [] }
    }
    if (sql === 'ROLLBACK') {
      client?.rollback()
      return { rows: [] }
    }
    if (sql.startsWith('SELECT payload FROM dataset_versions WHERE id = $1')) {
      const record = this.records.get(values[0])
      return { rows: record ? [{ payload: structuredClone(record) }] : [] }
    }
    if (sql === 'SELECT payload FROM dataset_versions ORDER BY id ASC') {
      return {
        rows: [...this.records.values()]
          .sort((left, right) => left.datasetVersion.id.localeCompare(right.datasetVersion.id))
          .map((payload) => ({ payload: structuredClone(payload) })),
      }
    }
    if (sql.startsWith('SELECT payload FROM dataset_versions WHERE dataset_id = $1 AND branch_id = $2')) {
      return {
        rows: [...this.records.values()]
          .filter((record) => record.datasetVersion.datasetId === values[0]
            && record.datasetVersion.branchId === values[1])
          .map((payload) => ({ payload: structuredClone(payload) })),
      }
    }
    if (sql.startsWith('SELECT payload FROM dataset_versions WHERE dataset_id = $1')) {
      return {
        rows: [...this.records.values()]
          .filter((record) => record.datasetVersion.datasetId === values[0]
            && (values[1] == null || record.datasetVersion.branchId === values[1])
            && record.datasetVersion.status === 'active')
          .map((payload) => ({ payload: structuredClone(payload) })),
      }
    }
    if (sql.startsWith('SELECT dataset_id, branch_id, dataset_version_id')) {
      const rows = [...this.pointers.values()]
        .filter((pointer) => pointer.dataset_id === values[0]
          && (sql.includes('branch_id = $2')
            ? pointer.branch_id === values[1]
            : values[1] == null || pointer.branch_id === values[1]))
        .sort((left, right) => left.branch_id.localeCompare(right.branch_id))
      return { rows }
    }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] }
    if (sql.startsWith('INSERT INTO dataset_versions')) {
      if (this.failInsert) {
        const error = this.failInsert
        this.failInsert = null
        throw error
      }
      const record = JSON.parse(values[13])
      this.records.set(values[0], record)
      return { rows: [] }
    }
    if (sql.startsWith('INSERT INTO audit_events')) {
      if (this.failAudit) {
        const error = this.failAudit
        this.failAudit = null
        throw error
      }
      this.auditEvents.push({
        event_id: values[0],
        event: values[1],
        dataset_version_id: values[3],
      })
      return { rows: [] }
    }
    if (sql.startsWith('UPDATE dataset_versions')) {
      this.records.set(values[0], JSON.parse(values[13]))
      return { rows: [] }
    }
    if (sql.startsWith('INSERT INTO dataset_active_pointers')) {
      const pointer = {
        dataset_id: values[0],
        branch_id: values[1],
        dataset_version_id: values[2],
        previous_dataset_version_id: values[3],
        revision: values[4],
        activated_by: values[5],
        activated_at: values[6],
        migrated_from_legacy_status: false,
      }
      this.pointers.set(`${values[0]}\u0000${values[1]}`, pointer)
      return { rows: [] }
    }
    if (sql.startsWith('INSERT INTO graph_revisions')) {
      return { rows: [{ graph_revision_id: `graph-revision-${values[0]}` }] }
    }
    if (sql.startsWith('DELETE FROM')) return { rows: [] }
    if (sql.startsWith('UPDATE graph_revisions')) return { rows: [] }
    return { rows: [] }
  }
}

class FakeClient {
  constructor(pool) {
    this.pool = pool
    this.snapshot = null
  }

  async query(text, values = []) {
    return this.pool.handle(text, values, this)
  }

  begin() {
    this.snapshot = {
      records: new Map([...this.pool.records].map(([id, record]) => [id, structuredClone(record)])),
      pointers: new Map([...this.pool.pointers].map(([id, pointer]) => [id, structuredClone(pointer)])),
      auditEvents: structuredClone(this.pool.auditEvents),
    }
  }

  commit() {
    this.snapshot = null
  }

  rollback() {
    if (!this.snapshot) return
    this.pool.records = this.snapshot.records
    this.pool.pointers = this.snapshot.pointers
    this.pool.auditEvents = this.snapshot.auditEvents
    this.snapshot = null
  }

  release() {
    this.pool.released += 1
  }
}
