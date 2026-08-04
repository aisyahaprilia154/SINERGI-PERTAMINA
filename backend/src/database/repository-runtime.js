import path from 'node:path'
import { JsonDatasetVersionRepository } from '../storage/dataset-version-repository.js'
import { PostgresDatasetVersionRepository } from '../storage/postgres-dataset-version-repository.js'
import { ShadowDatasetVersionRepository } from '../storage/shadow-dataset-version-repository.js'
import {
  closePostgresPool,
  createPostgresPool,
  POSTGRES_RUNTIME_REQUIRED_COLUMNS,
  verifyOperationalSchema,
} from './postgres-runtime.js'

/**
 * Builds the dataset repository boundary used by the server.
 *
 * `json` remains available for isolated development fixtures. `shadow` keeps
 * JSON as primary while comparing PostgreSQL reads. `postgres` makes the
 * PostgreSQL repository the only dataset aggregate source of truth.
 */
export async function createDatasetVersionRepositoryRuntime({
  config,
  logger = console,
  poolFactory = createPostgresPool,
} = {}) {
  if (!config?.dataRoot) {
    throw new TypeError('Repository runtime membutuhkan config.dataRoot.')
  }
  if ((config.storageMode ?? 'json') === 'json') {
    if (config.database?.shadowDatabaseUrl) {
      throw databaseRuntimeError(
        'shadow_mode_not_enabled',
        'SINERGI_SHADOW_DATABASE_URL tersedia tetapi SINERGI_STORAGE_MODE bukan shadow.',
      )
    }
    const repository = new JsonDatasetVersionRepository(
      path.join(config.dataRoot, 'dataset-versions'),
    )
    return {
      mode: 'json',
      pool: null,
      repository,
      primaryRepository: repository,
      shadowRepository: null,
      close: async () => {},
    }
  }
  if (!['shadow', 'postgres'].includes(config.storageMode)) {
    throw databaseRuntimeError(
      'storage_mode_unsupported',
      'Storage mode database belum didukung oleh runtime ini.',
    )
  }
  const isPostgresPrimary = config.storageMode === 'postgres'
  const connectionString = isPostgresPrimary
    ? config.database?.databaseUrl
    : config.database?.shadowDatabaseUrl
  if (!connectionString) {
    throw databaseRuntimeError(
      isPostgresPrimary ? 'database_url_required' : 'shadow_database_url_required',
      isPostgresPrimary
        ? 'Mode postgres membutuhkan SINERGI_DATABASE_URL.'
        : 'Mode shadow membutuhkan SINERGI_SHADOW_DATABASE_URL.',
    )
  }
  const pool = await poolFactory({
    connectionString,
    max: config.database?.poolMax,
    idleTimeoutMilliseconds: config.database?.idleTimeoutMilliseconds,
    connectionTimeoutMilliseconds: config.database?.connectionTimeoutMilliseconds,
    ssl: config.database?.ssl,
    logger,
  })
  try {
    if (isPostgresPrimary) {
      await verifyOperationalSchema(pool, {
        requiredColumns: POSTGRES_RUNTIME_REQUIRED_COLUMNS,
      })
      const repository = new PostgresDatasetVersionRepository(pool)
      return {
        mode: 'postgres',
        pool,
        repository,
        primaryRepository: repository,
        shadowRepository: null,
        close: () => closePostgresPool(pool),
      }
    }
    const primaryRepository = new JsonDatasetVersionRepository(
      path.join(config.dataRoot, 'dataset-versions'),
    )
    const shadowRepository = new PostgresDatasetVersionRepository(pool)
    const reporter = createShadowReporter(logger)
    const repository = new ShadowDatasetVersionRepository({
      primaryRepository,
      shadowRepository,
      reporter,
      awaitComparison: config.database?.shadowAwaitComparison,
    })
    return {
      mode: 'shadow',
      pool,
      repository,
      primaryRepository,
      shadowRepository,
      close: () => closePostgresPool(pool),
    }
  } catch (error) {
    await closePostgresPool(pool).catch(() => {})
    throw error
  }
}

function createShadowReporter(logger) {
  return (report) => {
    if (report.equal) return
    const safeReport = {
      operation: report.operation,
      datasetVersionId: report.datasetVersionId,
      comparedAt: report.comparedAt,
      equal: report.equal,
      primary: report.primary,
      shadow: report.shadow,
      mismatchCodes: (report.mismatches ?? []).map((mismatch) => mismatch.code),
    }
    const line = JSON.stringify(safeReport)
    if (typeof logger?.warn === 'function') logger.warn(`[shadow-compare] ${line}`)
  }
}

function databaseRuntimeError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
