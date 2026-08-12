import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  createMigrationChecksum,
  loadMigration,
  runMigration,
  SCHEMA_MIGRATIONS_BOOTSTRAP,
} from '../src/database/migration-runner.js'

const migrationDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/database/migrations',
)
const migrationId = '0001_operational_schema'

test('operational migration declares the indexed entity contract and reversible drops', async () => {
  const migration = await loadMigration(migrationDirectory, migrationId)
  const expectedTables = [
    'dataset_versions',
    'source_features',
    'source_geometries',
    'classified_objects',
    'topology_jobs',
    'topology_candidates',
    'confirmed_relations',
    'graph_revisions',
    'graph_nodes',
    'graph_edges',
    'accuracy_evaluations',
    'audit_events',
  ]

  for (const table of expectedTables) {
    assert.match(migration.upSql, new RegExp(`CREATE TABLE ${table} \\(`))
    assert.match(migration.downSql, new RegExp(`DROP TABLE IF EXISTS ${table}`))
  }
  assert.match(migration.upSql, /CREATE EXTENSION IF NOT EXISTS postgis/)
  assert.match(migration.upSql, /source_geometries USING GIST \(geometry\)/)
  assert.match(migration.upSql, /topology_candidates \(\s*\n\s*dataset_version_id,\s*\n\s*candidate_status/s)
  assert.match(migration.upSql, /confirmed_relations_candidate_fk[\s\S]+REFERENCES topology_candidates/)
  assert.match(migration.upSql, /UNIQUE \(dataset_version_id, candidate_id\)/)
  assert.match(migration.upSql, /graph_revisions_one_active_idx/)
  assert.match(migration.upSql, /audit_events_append_only/)
  assert.match(migration.downSql, /DROP FUNCTION IF EXISTS prevent_audit_event_mutation/)
})

test('migration runner applies and rolls back in one transaction', async () => {
  const migration = await loadMigration(migrationDirectory, migrationId)
  const client = new RecordingClient()
  const checksum = createMigrationChecksum(migration.upSql, migration.downSql)

  const applied = await runMigration(client, {
    ...migration,
    checksum,
    appliedAt: '2026-08-04T00:00:00.000Z',
  })
  assert.equal(applied.status, 'applied')
  assert.deepEqual(client.commands.slice(0, 2), ['BEGIN', SCHEMA_MIGRATIONS_BOOTSTRAP])
  assert.equal(client.commands.at(-1), 'COMMIT')
  assert.equal(client.applied.get(migrationId), checksum)

  const repeated = await runMigration(client, {
    ...migration,
    checksum,
  })
  assert.equal(repeated.status, 'already_applied')
  assert.equal(client.commands.at(-1), 'COMMIT')

  const rolledBack = await runMigration(client, {
    ...migration,
    direction: 'down',
    checksum,
  })
  assert.equal(rolledBack.status, 'applied')
  assert.equal(client.applied.has(migrationId), false)
  assert.equal(client.commands.at(-1), 'COMMIT')
})

test('migration runner rolls back when SQL or metadata write fails', async () => {
  const client = new RecordingClient({ failOn: 'migration-sql' })
  await assert.rejects(
    runMigration(client, {
      id: migrationId,
      upSql: '/* migration-sql */ SELECT 1',
      downSql: 'SELECT 1',
    }),
    /injected migration failure/,
  )
  assert.equal(client.commands.at(-1), 'ROLLBACK')
})

test('migration loader reads both directions from the repository', async () => {
  const up = await readFile(
    path.join(migrationDirectory, `${migrationId}.up.sql`),
    'utf8',
  )
  const down = await readFile(
    path.join(migrationDirectory, `${migrationId}.down.sql`),
    'utf8',
  )
  const migration = await loadMigration(migrationDirectory, migrationId)
  assert.equal(migration.upSql, up)
  assert.equal(migration.downSql, down)
})

test('active pointer migration adds one publication boundary per dataset branch', async () => {
  const migration = await loadMigration(
    migrationDirectory,
    '0002_dataset_active_pointers',
  )
  assert.match(migration.upSql, /CREATE TABLE dataset_active_pointers/)
  assert.match(migration.upSql, /PRIMARY KEY \(dataset_id, branch_id\)/)
  assert.match(migration.upSql, /FOREIGN KEY \(dataset_version_id\) REFERENCES dataset_versions/)
  assert.match(migration.upSql, /dataset_versions_one_active_idx/)
  assert.match(migration.downSql, /DROP TABLE IF EXISTS dataset_active_pointers/)
})

test('PostgreSQL primary runtime migration adds durable queue state columns', async () => {
  const migration = await loadMigration(
    migrationDirectory,
    '0003_postgres_runtime_state',
  )
  assert.match(migration.upSql, /ADD COLUMN IF NOT EXISTS schema_version/)
  assert.match(migration.upSql, /ADD COLUMN IF NOT EXISTS cancel_requested/)
  assert.match(migration.upSql, /ADD COLUMN IF NOT EXISTS revision/)
  assert.match(migration.upSql, /topology_jobs_dataset_status_available_idx/)
  assert.match(migration.downSql, /DROP COLUMN IF EXISTS schema_version/)
  assert.match(migration.downSql, /DROP COLUMN IF EXISTS revision/)
})

test('Fase 1 migration adds publication profile, identity registry, and diff projection', async () => {
  const migration = await loadMigration(
    migrationDirectory,
    '0004_phase_one_publication_identity_diff',
  )
  assert.match(migration.upSql, /publication_profile/)
  assert.match(migration.upSql, /CREATE TABLE asset_identity_registry/)
  assert.match(migration.upSql, /asset_identity_registry_active_source_idx/)
  assert.match(migration.upSql, /CREATE TABLE dataset_version_diffs/)
  assert.match(migration.upSql, /risk IN \('low', 'medium', 'high'\)/)
  assert.match(migration.downSql, /DROP TABLE IF EXISTS dataset_version_diffs/)
  assert.match(migration.downSql, /DROP TABLE IF EXISTS asset_identity_registry/)
})

class RecordingClient {
  constructor({ failOn = null } = {}) {
    this.commands = []
    this.applied = new Map()
    this.failOn = failOn
  }

  async query(query, values = []) {
    const text = typeof query === 'string' ? query : query.text
    this.commands.push(text)
    if (this.failOn === 'migration-sql' && text.includes('migration-sql')) {
      throw new Error('injected migration failure')
    }
    if (text.startsWith('SELECT migration_id')) {
      const id = values[0]
      const checksum = this.applied.get(id)
      return { rows: checksum ? [{ migration_id: id, checksum }] : [] }
    }
    if (text.startsWith('INSERT INTO schema_migrations')) {
      this.applied.set(values[0], values[1])
    }
    if (text.startsWith('DELETE FROM schema_migrations')) {
      this.applied.delete(values[0])
    }
    return { rows: [] }
  }
}
