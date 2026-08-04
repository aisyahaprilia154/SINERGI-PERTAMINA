import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { migratePilotDataset } from '../src/database/pilot-migration.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultPilotPath = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'dataset-version-pilot.json',
)

export async function runPilotMigration({
  pool,
  filePath = defaultPilotPath,
} = {}) {
  await verifyOperationalSchema(pool)
  const result = await migratePilotDataset({
    repository: new PostgresDatasetVersionRepository(pool),
    client: pool,
    filePath,
  })
  return {
    datasetVersionId: result.datasetVersionId,
    expected: result.expected,
    actual: result.actual,
    parity: result.parity,
  }
}

async function main() {
  const config = createConfig(process.env)
  const pool = await createPostgresPool({
    connectionString: config.database.databaseUrl,
    max: config.database.poolMax,
    idleTimeoutMilliseconds: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMilliseconds: config.database.connectionTimeoutMilliseconds,
    ssl: config.database.ssl,
  })
  try {
    const result = await runPilotMigration({ pool })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally {
    await closePostgresPool(pool)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-pilot] ${error.code ?? 'failed'}: ${error.message}\n`)
    process.exitCode = 1
  })
}
