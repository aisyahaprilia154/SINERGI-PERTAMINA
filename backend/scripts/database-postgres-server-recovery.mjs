import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  POSTGRES_RUNTIME_REQUIRED_COLUMNS,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { runPostgresServerRecoveryCheck } from '../src/database/postgres-server-recovery.js'
import { PostgresDurableJobRepository } from '../src/jobs/postgres-durable-job-repository.js'

const execFileAsync = promisify(execFile)
const DEFAULT_POSTGRES_SERVICE = 'postgresql-x64-18'
const DEFAULT_PG_BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 5432

export async function runLivePostgresServerRecovery({
  connectionString,
  serviceName = process.env.SINERGI_POSTGRES_SERVICE ?? DEFAULT_POSTGRES_SERVICE,
  pgBin = process.env.SINERGI_POSTGRES_BIN ?? DEFAULT_PG_BIN,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  poolFactory = createPostgresPool,
  restartDatabase = () => restartWindowsPostgresService({ serviceName }),
  waitForReady = () => waitForPostgresReady({ pgBin, host, port }),
} = {}) {
  if (!String(connectionString ?? '').trim()) {
    throw recoveryError(
      'database_url_required',
      'SINERGI_DATABASE_URL wajib tersedia sebelum server recovery dijalankan.',
    )
  }
  validateServiceName(serviceName)
  return runPostgresServerRecoveryCheck({
    openStore: async (phase) => openPostgresStore({
      connectionString,
      phase,
      poolFactory,
    }),
    restartDatabase,
    waitForReady,
  })
}

export async function openPostgresStore({
  connectionString,
  phase = 'unknown',
  poolFactory = createPostgresPool,
} = {}) {
  const pool = await poolFactory({ connectionString })
  try {
    const schema = await verifyOperationalSchema(pool, {
      requiredColumns: POSTGRES_RUNTIME_REQUIRED_COLUMNS,
    })
    const repository = new PostgresDurableJobRepository(pool)
    return {
      phase,
      schema,
      get: repository.get.bind(repository),
      list: repository.list.bind(repository),
      create: repository.create.bind(repository),
      claimNext: repository.claimNext.bind(repository),
      complete: repository.complete.bind(repository),
      deleteJob: async (jobId) => {
        await pool.query('DELETE FROM topology_jobs WHERE job_id = $1', [jobId])
      },
      close: () => closePostgresPool(pool),
    }
  } catch (error) {
    await closePostgresPool(pool)
    throw error
  }
}

export async function restartWindowsPostgresService({
  serviceName = DEFAULT_POSTGRES_SERVICE,
} = {}) {
  validateServiceName(serviceName)
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$ErrorActionPreference = 'Stop'; Restart-Service -Name '${serviceName}' -Force`,
  ], {
    windowsHide: true,
    maxBuffer: 256 * 1024,
  })
}

export async function waitForPostgresReady({
  pgBin = DEFAULT_PG_BIN,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  timeoutMilliseconds = 30_000,
  pollMilliseconds = 250,
} = {}) {
  const pgIsReady = path.join(pgBin, process.platform === 'win32'
    ? 'pg_isready.exe'
    : 'pg_isready')
  const deadline = Date.now() + timeoutMilliseconds
  let lastError = null
  while (Date.now() < deadline) {
    try {
      await execFileAsync(pgIsReady, [
        '-h',
        host,
        '-p',
        String(port),
        '-t',
        '1',
      ], {
        windowsHide: true,
        maxBuffer: 64 * 1024,
      })
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, pollMilliseconds))
    }
  }
  throw recoveryError(
    'database_server_not_ready',
    'PostgreSQL tidak kembali ready setelah service restart.',
    { timeoutMilliseconds, lastError: String(lastError?.message ?? lastError ?? '') },
  )
}

function validateServiceName(value) {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(String(value ?? ''))) {
    throw recoveryError(
      'invalid_postgres_service_name',
      'Nama service PostgreSQL tidak valid.',
    )
  }
}

function recoveryError(code, message, details = undefined) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}

async function main() {
  const config = createConfig(process.env, { storageMode: 'postgres' })
  const result = await runLivePostgresServerRecovery({
    connectionString: config.database.databaseUrl,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `[database-postgres-server-recovery] ${error.code ?? 'failed'}: ${error.message}\n`,
    )
    if (error.details) process.stderr.write(`${JSON.stringify(error.details)}\n`)
    process.exitCode = 1
  })
}
