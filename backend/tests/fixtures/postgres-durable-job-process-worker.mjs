import { createConfig } from '../../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  POSTGRES_RUNTIME_REQUIRED_COLUMNS,
  verifyOperationalSchema,
} from '../../src/database/postgres-runtime.js'
import { PostgresDurableJobRepository } from '../../src/jobs/postgres-durable-job-repository.js'

const [mode, jobId, workerId, leaseText] = process.argv.slice(2)
const leaseMilliseconds = Number(leaseText)

if (!['claim-and-exit', 'recover-and-complete'].includes(mode)
  || !jobId
  || !workerId
  || !Number.isInteger(leaseMilliseconds)
  || leaseMilliseconds < 1) {
  throw new Error('Fixture PostgreSQL recovery menerima argumen yang tidak valid.')
}

let pool = null
try {
  const config = createConfig(process.env, { storageMode: 'postgres' })
  pool = await createPostgresPool({ connectionString: config.database.databaseUrl })
  await verifyOperationalSchema(pool, {
    requiredColumns: POSTGRES_RUNTIME_REQUIRED_COLUMNS,
  })
  const repository = new PostgresDurableJobRepository(pool)

  if (mode === 'claim-and-exit') {
    const claimed = await repository.claimNext({
      workerId,
      leaseMilliseconds,
    })
    if (!claimed || claimed.jobId !== jobId) {
      throw workerError('database_recovery_claim_not_target', {
        claimedJobId: claimed?.jobId ?? null,
      })
    }
    await writeAndExit({
      type: 'claimed',
      jobId,
      workerId,
      attemptCount: claimed.attemptCount,
      lockExpiresAt: claimed.lockExpiresAt,
    }, 17)
  }

  let recovered = []
  for (let attempt = 0; attempt < 20; attempt += 1) {
    recovered = await repository.recoverExpiredLeases({
      retryAvailableAt: new Date().toISOString(),
    })
    if (recovered.some((job) => job.jobId === jobId)) break
    await delay(25)
  }
  const claimed = await repository.claimNext({
    workerId,
    leaseMilliseconds,
  })
  if (!claimed || claimed.jobId !== jobId) {
    throw workerError('database_recovery_reclaim_not_target', {
      claimedJobId: claimed?.jobId ?? null,
      recoveredJobIds: recovered.map(({ jobId: recoveredJobId }) => recoveredJobId),
    })
  }
  const completed = await repository.complete(jobId, workerId, {
    recoveredFrom: jobId,
    replacementWorkerId: workerId,
  })
  await closePostgresPool(pool)
  pool = null
  process.stdout.write(`${JSON.stringify({
    type: 'completed',
    jobId,
    workerId,
    recoveredJobCount: recovered.length,
    attemptCount: completed.attemptCount,
    status: completed.status,
  })}\n`)
} catch (error) {
  process.stderr.write(
    `[postgres-recovery-worker] ${error.code ?? 'failed'}: ${error.message}\n`,
  )
  if (error.details) process.stderr.write(`${JSON.stringify(error.details)}\n`)
  process.exitCode = 1
} finally {
  await closePostgresPool(pool).catch(() => {})
}

function workerError(code, details) {
  const error = new Error('PostgreSQL recovery worker fixture gagal.')
  error.code = code
  error.details = details
  return error
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function writeAndExit(message, code) {
  return new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(message)}\n`, () => {
      process.exit(code)
      resolve()
    })
  })
}
