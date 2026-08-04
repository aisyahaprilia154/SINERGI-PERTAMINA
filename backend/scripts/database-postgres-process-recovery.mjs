import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createConfig } from '../src/config.js'
import {
  closePostgresPool,
  createPostgresPool,
  POSTGRES_RUNTIME_REQUIRED_COLUMNS,
  verifyOperationalSchema,
} from '../src/database/postgres-runtime.js'
import { PostgresDurableJobRepository } from '../src/jobs/postgres-durable-job-repository.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workerFixture = path.resolve(
  scriptDirectory,
  '../tests/fixtures/postgres-durable-job-process-worker.mjs',
)
const DEFAULT_LEASE_MILLISECONDS = 1_500

/**
 * Proves that a PostgreSQL durable job survives a process exit after claim.
 * The first child intentionally exits without closing its pool. A replacement
 * child opens a new pool, recovers the expired lease, and completes the same
 * job. Only the generated probe job is cleaned up in the finally block.
 */
export async function runPostgresProcessRecoveryCheck({
  connectionString = createConfig(process.env).database.databaseUrl,
  poolFactory = createPostgresPool,
  leaseMilliseconds = DEFAULT_LEASE_MILLISECONDS,
} = {}) {
  const pool = await poolFactory({ connectionString })
  const repository = new PostgresDurableJobRepository(pool)
  const normalizedLeaseMilliseconds = positiveInteger(
    leaseMilliseconds,
    DEFAULT_LEASE_MILLISECONDS,
  )
  const jobId = `live-pg-recovery-${randomUUID().replaceAll('-', '')}`
  const inputFingerprint = `live-pg-process-recovery:${jobId}`
  let created = false
  try {
    const schema = await verifyOperationalSchema(pool, {
      requiredColumns: POSTGRES_RUNTIME_REQUIRED_COLUMNS,
    })
    const queuedBefore = await repository.list({ statuses: ['queued', 'retry_wait'] })
    if (queuedBefore.length) {
      throw recoveryError(
        'database_recovery_fixture_queue_not_empty',
        'Fixture recovery membutuhkan PostgreSQL queue tanpa job queued lain.',
        { jobIds: queuedBefore.map(({ jobId: queuedJobId }) => queuedJobId) },
      )
    }

    const createdJob = await repository.create({
      jobId,
      jobType: 'parse_source',
      datasetVersionId: null,
      inputFingerprint,
      ruleSetVersion: 'live-process-recovery/1.0.0',
      payload: { probe: 'postgres-process-recovery' },
      maxAttempts: 3,
    })
    created = true
    const queuedAfter = await repository.list({ statuses: ['queued', 'retry_wait'] })
    if (queuedAfter.length !== 1 || queuedAfter[0].jobId !== jobId) {
      throw recoveryError(
        'database_recovery_fixture_queue_changed',
        'Fixture recovery mendeteksi queued job lain sebelum child process dimulai.',
        { jobIds: queuedAfter.map(({ jobId: queuedJobId }) => queuedJobId) },
      )
    }

    const crashedWorkerId = `crashed-pg-worker-${process.pid}`
    const crashed = await runWorker({
      mode: 'claim-and-exit',
      jobId,
      workerId: crashedWorkerId,
      leaseMilliseconds: normalizedLeaseMilliseconds,
    })
    assertChildMessage(crashed, 'claimed', {
      expectedExitCode: 17,
      expectedJobId: jobId,
    })

    const inFlight = await repository.get(jobId)
    if (inFlight.status !== 'running'
      || inFlight.attemptCount !== 1
      || inFlight.lockedBy !== crashedWorkerId
      || !inFlight.lockExpiresAt) {
      throw recoveryError(
        'database_recovery_claim_invalid',
        'Child process pertama tidak meninggalkan lease PostgreSQL yang valid.',
        {
          status: inFlight.status,
          attemptCount: inFlight.attemptCount,
          lockedBy: inFlight.lockedBy,
          lockExpiresAt: inFlight.lockExpiresAt,
        },
      )
    }

    await waitUntil(async () => {
      const current = await repository.get(jobId)
      return Date.parse(current.lockExpiresAt) <= Date.now()
    })

    const replacementWorkerId = `replacement-pg-worker-${process.pid}`
    const replacement = await runWorker({
      mode: 'recover-and-complete',
      jobId,
      workerId: replacementWorkerId,
      leaseMilliseconds: normalizedLeaseMilliseconds,
    })
    assertChildMessage(replacement, 'completed', {
      expectedExitCode: 0,
      expectedJobId: jobId,
    })

    const completed = await repository.get(jobId)
    if (completed.status !== 'succeeded'
      || completed.attemptCount !== 2
      || completed.lockedBy !== null
      || completed.lockExpiresAt !== null
      || completed.result?.recoveredFrom !== jobId) {
      throw recoveryError(
        'database_recovery_completion_invalid',
        'Replacement process tidak menyelesaikan durable job sesuai kontrak.',
        {
          status: completed.status,
          attemptCount: completed.attemptCount,
          lockedBy: completed.lockedBy,
          lockExpiresAt: completed.lockExpiresAt,
          result: completed.result,
        },
      )
    }

    const duplicate = await repository.create({
      jobType: createdJob.jobType,
      datasetVersionId: createdJob.datasetVersionId,
      inputFingerprint: createdJob.inputFingerprint,
      ruleSetVersion: createdJob.ruleSetVersion,
      payload: createdJob.payload,
      maxAttempts: createdJob.maxAttempts,
    })
    if (duplicate.jobId !== jobId || duplicate.deduplicated !== true) {
      throw recoveryError(
        'database_recovery_idempotency_invalid',
        'Enqueue ulang probe tidak mengembalikan job PostgreSQL yang sama.',
        { duplicateJobId: duplicate.jobId, deduplicated: duplicate.deduplicated },
      )
    }

    return {
      result: 'passed',
      schema,
      jobId,
      crashedWorkerId,
      crashedExitCode: crashed.exitCode,
      replacementWorkerId,
      recoveredJobCount: replacement.message.recoveredJobCount,
      finalStatus: completed.status,
      finalAttemptCount: completed.attemptCount,
      finalRevision: completed.revision,
      idempotencyDeduplicated: duplicate.deduplicated,
    }
  } finally {
    try {
      if (created) {
        await pool.query('DELETE FROM topology_jobs WHERE job_id = $1', [jobId])
      }
    } finally {
      await closePostgresPool(pool)
    }
  }
}

async function runWorker({ mode, jobId, workerId, leaseMilliseconds }) {
  const child = spawn(process.execPath, [
    workerFixture,
    mode,
    jobId,
    workerId,
    String(leaseMilliseconds),
  ], {
    cwd: path.resolve(scriptDirectory, '..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return waitForChild(child)
}

function waitForChild(child, timeoutMilliseconds = 10_000) {
  return new Promise((resolve, reject) => {
    const stdout = []
    const stderr = []
    const timer = setTimeout(() => {
      cleanup()
      child.kill()
      reject(new Error('PostgreSQL recovery child process melewati batas waktu.'))
    }, timeoutMilliseconds)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr?.on('data', (chunk) => stderr.push(chunk))
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onClose = (code, signal) => {
      cleanup()
      const messages = stdout.join('').trim().split('\n')
        .filter(Boolean)
        .map(parseChildMessage)
      resolve({
        exitCode: code,
        signal,
        message: messages.at(-1) ?? null,
        messages,
        stderr: stderr.join('').trim(),
      })
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('error', onError)
      child.off('close', onClose)
    }
    child.once('error', onError)
    child.once('close', onClose)
  })
}

function parseChildMessage(line) {
  try {
    return JSON.parse(line)
  } catch {
    return { type: 'invalid_child_output', line: line.slice(0, 500) }
  }
}

function assertChildMessage(child, expectedType, {
  expectedExitCode,
  expectedJobId,
}) {
  if (child.exitCode !== expectedExitCode
    || child.signal !== null
    || child.message?.type !== expectedType
    || child.message?.jobId !== expectedJobId) {
    throw recoveryError(
      'database_recovery_child_invalid',
      'Child process recovery menghasilkan status yang tidak diharapkan.',
      {
        expectedType,
        expectedExitCode,
        actualExitCode: child.exitCode,
        actualSignal: child.signal,
        message: child.message,
      },
    )
  }
}

async function waitUntil(predicate, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw recoveryError(
    'database_recovery_lease_timeout',
    'Lease PostgreSQL tidak kedaluwarsa sesuai batas waktu.',
  )
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

function recoveryError(code, message, details = undefined) {
  const error = new Error(message)
  error.code = code
  if (details) error.details = details
  return error
}

async function main() {
  const config = createConfig(process.env, { storageMode: 'postgres' })
  const result = await runPostgresProcessRecoveryCheck({
    connectionString: config.database.databaseUrl,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `[database-postgres-process-recovery] ${error.code ?? 'failed'}: ${error.message}\n`,
    )
    if (error.details) {
      process.stderr.write(`${JSON.stringify(error.details)}\n`)
    }
    process.exitCode = 1
  })
}
