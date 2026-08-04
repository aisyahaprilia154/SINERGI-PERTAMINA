import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { createConfig } from '../src/config.js'
import {
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { createDatasetVersionRepositoryRuntime } from '../src/database/repository-runtime.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import { parseMigrationArguments } from '../scripts/database-migrate.mjs'

test('database runtime keeps JSON as the explicit default and rejects ambiguous shadow configuration', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'sinergi-runtime-'))
  const runtime = await createDatasetVersionRepositoryRuntime({
    config: createConfig({}, { dataRoot }),
  })
  assert.equal(runtime.mode, 'json')
  assert.ok(runtime.repository instanceof JsonDatasetVersionRepository)
  await runtime.close()

  await assert.rejects(
    createDatasetVersionRepositoryRuntime({
      config: createConfig({}, {
        dataRoot,
        database: { shadowDatabaseUrl: 'postgresql://shadow.example/db' },
      }),
    }),
    (error) => error.code === 'shadow_mode_not_enabled',
  )
})

test('shadow runtime creates only a PostgreSQL read comparator and closes its pool', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'sinergi-shadow-runtime-'))
  const pool = {
    ended: false,
    async query() {
      return { rows: [] }
    },
    async connect() {
      return {
        query: this.query.bind(this),
        release() {},
      }
    },
    async end() {
      this.ended = true
    },
  }
  const runtime = await createDatasetVersionRepositoryRuntime({
    config: createConfig({}, {
      dataRoot,
      storageMode: 'shadow',
      database: {
        shadowDatabaseUrl: 'postgresql://shadow.example/db',
        shadowAwaitComparison: false,
      },
    }),
    poolFactory: async () => pool,
  })
  assert.equal(runtime.mode, 'shadow')
  assert.equal(typeof runtime.repository.get, 'function')
  assert.equal(typeof runtime.repository.create, 'function')
  await runtime.close()
  assert.equal(pool.ended, true)
})

test('database URL selects PostgreSQL as the primary repository and verifies runtime columns', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'sinergi-postgres-runtime-'))
  const pool = {
    ended: false,
    async query(query) {
      const text = String(query)
      if (text.includes('FROM pg_extension')) {
        return { rows: [{ extversion: '3.6.2' }] }
      }
      return { rows: [] }
    },
    async connect() {
      return { query: this.query.bind(this), release() {} }
    },
    async end() {
      this.ended = true
    },
  }
  const config = createConfig({}, {
    dataRoot,
    database: { databaseUrl: 'postgresql://primary.example/sinergi' },
  })
  assert.equal(config.storageMode, 'postgres')
  const runtime = await createDatasetVersionRepositoryRuntime({
    config,
    poolFactory: async () => pool,
  })
  assert.equal(runtime.mode, 'postgres')
  assert.ok(runtime.repository instanceof PostgresDatasetVersionRepository)
  assert.equal(runtime.pool, pool)
  await runtime.close()
  assert.equal(pool.ended, true)
})

test('PostgreSQL pool factory validates the URL and keeps connection options bounded', async () => {
  let options = null
  let poolErrorHandler = null
  class FakePool {
    constructor(value) {
      options = value
    }
    on(eventName, handler) {
      if (eventName === 'error') poolErrorHandler = handler
    }
  }
  let loggedError = null
  const pool = await createPostgresPool({
    connectionString: 'postgresql://user:password@example.test/db',
    max: 12,
    idleTimeoutMilliseconds: 1_000,
    connectionTimeoutMilliseconds: 2_000,
    ssl: true,
    logger: {
      error(message) {
        loggedError = message
      },
    },
    loadPg: async () => ({ Pool: FakePool }),
  })
  assert.ok(pool instanceof FakePool)
  assert.deepEqual(options, {
    connectionString: 'postgresql://user:password@example.test/db',
    max: 12,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 2_000,
    ssl: true,
  })
  assert.equal(typeof poolErrorHandler, 'function')
  poolErrorHandler(Object.assign(new Error('connection reset'), {
    code: 'ECONNRESET',
  }))
  assert.equal(loggedError, '[postgres-pool] ECONNRESET: connection reset')
  await assert.rejects(
    createPostgresPool({
      connectionString: 'not-a-database-url',
      loadPg: async () => ({ Pool: FakePool }),
    }),
    (error) => error.code === 'database_url_invalid',
  )
})

test('operational schema verification fails closed when PostGIS or a table is missing', async () => {
  const missingPostgis = {
    async query() {
      return { rows: [] }
    },
  }
  await assert.rejects(
    verifyOperationalSchema(missingPostgis),
    (error) => error.code === 'postgis_extension_missing',
  )

  const missingTable = {
    calls: 0,
    queries: [],
    async query(query) {
      this.calls += 1
      this.queries.push(query)
      return this.calls === 1
        ? { rows: [{ extversion: '3.4.0' }] }
        : { rows: [{ table_name: 'dataset_versions', relation_name: null }] }
    },
  }
  await assert.rejects(
    verifyOperationalSchema(missingTable, {
      requiredTables: ['dataset_versions'],
    }),
    (error) => error.code === 'database_schema_not_ready'
      && error.details.missingTables[0] === 'dataset_versions',
  )
  assert.match(missingTable.queries[1], /AS required_table\(table_name\)/)
})

test('database rollback requires an explicit confirmation flag', () => {
  assert.throws(
    () => parseMigrationArguments(['--down']),
    (error) => error.code === 'database_rollback_confirmation_required',
  )
  assert.deepEqual(
    parseMigrationArguments(['--down', '--confirm-down']),
    { direction: 'down' },
  )
})
