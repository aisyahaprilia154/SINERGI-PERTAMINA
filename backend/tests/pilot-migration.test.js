import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import {
  assertProjectionParity,
  countAggregateEntities,
  countProjectionRows,
  loadPilotDataset,
  migratePilotDataset,
} from '../src/database/pilot-migration.js'

const pilotPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/dataset-version-pilot.json',
)

test('pilot JSON has a complete deterministic entity count contract', async () => {
  const record = await loadPilotDataset(pilotPath)
  assert.equal(record.datasetVersion.id, 'dv-pilot-parity')
  assert.deepEqual(countAggregateEntities(record), {
    dataset_versions: 1,
    source_features: 3,
    source_geometries: 3,
    classified_objects: 3,
    topology_jobs: 0,
    topology_candidates: 1,
    topology_components: 0,
    topology_interfaces: 0,
    confirmed_relations: 1,
    graph_revisions: 1,
    graph_nodes: 2,
    graph_edges: 1,
    accuracy_evaluations: 0,
    audit_events: 0,
  })
})

test('pilot migration verifies projection counts inside the repository transaction', async () => {
  const record = await loadPilotDataset(pilotPath)
  const expected = countAggregateEntities(record)
  const pool = new ProjectionPool(expected)
  const repository = new PostgresDatasetVersionRepository(pool)
  const result = await migratePilotDataset({
    repository,
    client: pool,
    filePath: pilotPath,
  })
  assert.equal(result.parity.equal, true)
  assert.deepEqual(result.expected, expected)
  assert.deepEqual(result.actual, expected)
  assert.equal(pool.committed, true)
  assert.equal(pool.rolledBack, false)
})

test('pilot migration aborts when one projection count is missing', async () => {
  const record = await loadPilotDataset(pilotPath)
  const expected = countAggregateEntities(record)
  const actual = { ...expected, topology_candidates: 0 }
  const pool = new ProjectionPool(actual)
  const repository = new PostgresDatasetVersionRepository(pool)

  await assert.rejects(
    migratePilotDataset({
      repository,
      client: pool,
      filePath: pilotPath,
    }),
    (error) => error.code === 'pilot_parity_failed'
      && error.details.mismatches[0].table === 'topology_candidates',
  )
  assert.equal(pool.committed, false)
  assert.equal(pool.rolledBack, true)
})

test('parity assertion rejects extra or missing tables instead of silently normalizing them', () => {
  assert.throws(
    () => assertProjectionParity(
      { dataset_versions: 1 },
      { dataset_versions: 1, unexpected_projection: 1 },
    ),
    (error) => error.code === 'pilot_parity_failed'
      && error.details.mismatches[0].table === 'unexpected_projection',
  )
})

test('projection count queries are parameterized by dataset version', async () => {
  const client = {
    queries: [],
    async query(text, values) {
      this.queries.push({ text, values })
      return { rows: [{ count: '0' }] }
    },
  }
  await countProjectionRows(client, 'dv-pilot-parity')
  assert.ok(client.queries.length > 0)
  assert.ok(client.queries.every(({ values }) => (
    values.length === 1 && values[0] === 'dv-pilot-parity'
  )))
})

class ProjectionPool {
  constructor(counts) {
    this.counts = counts
    this.committed = false
    this.rolledBack = false
  }

  async query(text, values = []) {
    return this.#query(text, values, null)
  }

  async connect() {
    return new ProjectionClient(this)
  }

  #query(text, values, client) {
    const normalized = text.trim().replace(/\s+/g, ' ')
    if (normalized === 'BEGIN') return client?.begin() ?? { rows: [] }
    if (normalized === 'COMMIT') {
      this.committed = true
      client?.commit()
      return { rows: [] }
    }
    if (normalized === 'ROLLBACK') {
      this.rolledBack = true
      client?.rollback()
      return { rows: [] }
    }
    if (normalized.startsWith('SELECT COUNT(*)::int AS count FROM ')) {
      const table = normalized.match(
        /^SELECT COUNT\(\*\)::int AS count FROM ([a-z_]+) WHERE/,
      )?.[1]
      return { rows: [{ count: this.counts[table] ?? 0 }] }
    }
    if (normalized.startsWith('INSERT INTO graph_revisions')) {
      return { rows: [{ graph_revision_id: 1 }] }
    }
    return { rows: [] }
  }

  queryFromClient(text, values, client) {
    return this.#query(text, values, client)
  }
}

class ProjectionClient {
  constructor(pool) {
    this.pool = pool
  }

  async query(text, values = []) {
    return this.pool.queryFromClient(text, values, this)
  }

  begin() {
    return { rows: [] }
  }

  commit() {
    return { rows: [] }
  }

  rollback() {
    return { rows: [] }
  }

  release() {}
}
