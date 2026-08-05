import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { loadPilotDataset } from '../src/database/pilot-migration.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import { ShadowDatasetVersionRepository } from '../src/storage/shadow-dataset-version-repository.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultPilotPath = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'dataset-version-pilot.json',
)

/**
 * Compares the pilot aggregate from a temporary JSON primary against the
 * already-migrated PostgreSQL shadow without writing to PostgreSQL.
 */
export async function runShadowPilot({
  connectionString,
  filePath = defaultPilotPath,
  poolFactory = createPostgresPool,
  clock = () => new Date(),
} = {}) {
  const record = await loadPilotDataset(filePath)
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sinergi-shadow-pilot-'))
  let pool = null
  try {
    const primaryRepository = new JsonDatasetVersionRepository(
      path.join(temporaryRoot, 'dataset-versions'),
    )
    await primaryRepository.create(record)

    pool = await poolFactory({ connectionString })
    const schema = await verifyOperationalSchema(pool)
    const shadowRepository = new PostgresDatasetVersionRepository(pool)
    const repository = new ShadowDatasetVersionRepository({
      primaryRepository,
      shadowRepository: createPilotScopedShadowRepository(
        shadowRepository,
        record.datasetVersion.id,
      ),
      awaitComparison: true,
      clock,
    })
    const datasetVersionId = record.datasetVersion.id
    const datasetId = record.datasetVersion.datasetId
    const branchId = record.datasetVersion.branchId

    await repository.get(datasetVersionId)
    await repository.list()
    await repository.findActive(datasetId, { branchId })
    await repository.resolveActiveVersion({ datasetId, branchId })

    const reports = repository.listComparisons()
    const mismatches = reports.filter((report) => report.equal !== true)
    return {
      datasetVersionId,
      schema,
      comparisonCount: reports.length,
      equal: mismatches.length === 0,
      reports,
    }
  } finally {
    await closePostgresPool(pool).catch(() => {})
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

/**
 * The live database can contain other datasets and append-only audit evidence.
 * The temporary JSON primary contains only the pilot fixture, so list parity
 * must compare the same dataset-version scope instead of treating unrelated
 * live records as a pilot mismatch.
 */
export function createPilotScopedShadowRepository(repository, datasetVersionId) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('Shadow repository pilot harus berupa repository object.')
  }
  const scopedId = String(datasetVersionId ?? '').trim()
  if (!scopedId) {
    throw new TypeError('Dataset version ID pilot wajib tersedia.')
  }
  return {
    get: (...args) => repository.get(...args),
    list: async (...args) => {
      const records = await repository.list(...args)
      return (Array.isArray(records) ? records : []).filter((candidate) => (
        candidate?.datasetVersion?.id === scopedId
      ))
    },
    findActive: (...args) => repository.findActive(...args),
    resolveActiveVersion: (...args) => repository.resolveActiveVersion(...args),
  }
}

export function assertShadowPilotEqual(result) {
  if (result?.equal === true) return result
  const error = new Error(
    'Shadow pilot parity mismatch; live verification dihentikan fail-closed.',
  )
  error.code = 'shadow_pilot_parity_mismatch'
  error.details = {
    comparisonCount: result?.comparisonCount ?? null,
    mismatches: (result?.reports ?? [])
      .filter((report) => report?.equal !== true)
      .flatMap((report) => report?.mismatches ?? [])
      .slice(0, 100),
  }
  throw error
}

async function main() {
  const config = createConfig(process.env)
  const connectionString = config.database.shadowDatabaseUrl
    ?? config.database.databaseUrl
  const result = await runShadowPilot({
    connectionString,
    clock: () => new Date(),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  assertShadowPilotEqual(result)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-shadow-pilot] ${error.code ?? 'failed'}: ${error.message}\n`)
    process.exitCode = 1
  })
}
