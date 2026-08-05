import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'

export async function runDatabaseConcurrencyCheck({
  connectionString,
  poolFactory = createPostgresPool,
} = {}) {
  const pool = await poolFactory({ connectionString })
  const datasetVersionId = `live-concurrency-${randomUUID().replaceAll('-', '')}`
  const repository = new PostgresDatasetVersionRepository(pool)
  try {
    const schema = await verifyOperationalSchema(pool)
    await repository.create(createConcurrencyRecord(datasetVersionId))

    const results = await Promise.allSettled([
      repository.update(datasetVersionId, (record) => ({
        ...record,
        concurrencyMarker: 'writer-a',
      }), { expectedRevision: 0 }),
      repository.update(datasetVersionId, (record) => ({
        ...record,
        concurrencyMarker: 'writer-b',
      }), { expectedRevision: 0 }),
    ])
    const successes = results.filter((result) => result.status === 'fulfilled')
    const conflicts = results.filter((result) => (
      result.status === 'rejected'
      && result.reason?.code === 'dataset_version_stale_revision'
    ))
    const unexpectedFailures = results.filter((result) => (
      result.status === 'rejected'
      && result.reason?.code !== 'dataset_version_stale_revision'
    ))
    const current = await repository.get(datasetVersionId)

    if (successes.length !== 1 || conflicts.length !== 1 || unexpectedFailures.length) {
      const error = new Error('PostgreSQL concurrency check gagal.')
      error.code = 'database_concurrency_check_failed'
      error.details = {
        resultCodes: results.map((result) => result.status === 'fulfilled'
          ? 'fulfilled'
          : String(result.reason?.code ?? 'unknown_failure')),
        successes: successes.length,
        conflicts: conflicts.length,
        unexpectedFailures: unexpectedFailures.length,
      }
      throw error
    }

    return {
      schema,
      datasetVersionId,
      successCount: successes.length,
      staleConflictCount: conflicts.length,
      unexpectedFailureCount: unexpectedFailures.length,
      finalRecordRevision: current.recordRevision,
      finalConcurrencyMarker: current.concurrencyMarker,
      result: 'passed',
    }
  } finally {
    await pool.query('DELETE FROM dataset_versions WHERE id = $1', [datasetVersionId])
    await closePostgresPool(pool)
  }
}

function createConcurrencyRecord(id) {
  return {
    contractVersion: '1.0.0',
    datasetVersion: {
      id,
      datasetId: 'dataset-live-concurrency',
      branchId: 'branch-live-concurrency',
      versionName: id,
      validationStatus: 'valid',
      publicationStatus: 'unpublished',
      status: 'valid',
    },
    validation: {
      status: 'valid',
      canActivate: true,
      summary: { errors: 0 },
    },
    sourceFeatures: [],
    sourceGeometries: [],
    classifiedObjects: [],
    topologyCandidates: [],
    confirmedRelations: [],
    topologyGraph: null,
  }
}

async function main() {
  const config = createConfig(process.env)
  const result = await runDatabaseConcurrencyCheck({
    connectionString: config.database.databaseUrl,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-concurrency] ${error.code ?? 'failed'}: ${error.message}\n`)
    if (error.details) {
      process.stderr.write(`${JSON.stringify(error.details)}\n`)
    }
    process.exitCode = 1
  })
}
