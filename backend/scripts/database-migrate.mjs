import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { loadMigration, runMigration } from '../src/database/migration-runner.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationDirectory = path.join(projectRoot, 'src', 'database', 'migrations')
const migrationIds = Object.freeze([
  '0001_operational_schema',
  '0002_dataset_active_pointers',
  '0003_postgres_runtime_state',
])

export async function runDatabaseMigrations({
  pool,
  direction = 'up',
  migrationDirectory: directory = migrationDirectory,
  appliedAt = new Date().toISOString(),
} = {}) {
  if (!['up', 'down'].includes(direction)) {
    throw new TypeError('Migration direction harus berupa up atau down.')
  }
  if (typeof pool?.connect !== 'function') {
    throw new TypeError('Database pool harus menyediakan connect().')
  }
  const ids = direction === 'up' ? migrationIds : [...migrationIds].reverse()
  const results = []
  for (const id of ids) {
    const migration = await loadMigration(directory, id)
    const client = await pool.connect()
    try {
      results.push(await runMigration(client, {
        ...migration,
        direction,
        appliedAt,
      }))
    } finally {
      client.release?.()
    }
  }
  if (direction === 'up') await verifyOperationalSchema(pool)
  return results
}

export function parseMigrationArguments(argv = []) {
  const direction = argv.includes('--direction=down') || argv.includes('--down')
    ? 'down'
    : 'up'
  if (direction === 'down' && !argv.includes('--confirm-down')) {
    const error = new Error('Rollback membutuhkan flag --confirm-down.')
    error.code = 'database_rollback_confirmation_required'
    throw error
  }
  return { direction }
}

async function main() {
  const { direction } = parseMigrationArguments(process.argv.slice(2))
  const config = createConfig(process.env)
  const pool = await createPostgresPool({
    connectionString: config.database.databaseUrl,
    max: config.database.poolMax,
    idleTimeoutMilliseconds: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMilliseconds: config.database.connectionTimeoutMilliseconds,
    ssl: config.database.ssl,
  })
  try {
    const results = await runDatabaseMigrations({ pool, direction })
    process.stdout.write(`${JSON.stringify({ direction, results }, null, 2)}\n`)
  } finally {
    await closePostgresPool(pool)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[database-migrate] ${error.code ?? 'failed'}: ${error.message}\n`)
    process.exitCode = 1
  })
}
