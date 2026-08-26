import { randomUUID } from 'node:crypto'
import { AppError } from '../errors.js'

const RECOVERY_JOB_TYPE = 'parse_source'
const RECOVERY_RULE_SET_VERSION = 'postgres-server-recovery/1.0.0'

/**
 * Runs the durable-job portion of a PostgreSQL server restart probe.
 *
 * The store is deliberately injected so the orchestration contract can be
 * tested without pretending that a fake pool proves a live database restart.
 * The live command supplies a PostgreSQL-backed store and a real service
 * restart callback.
 */
export async function runPostgresServerRecoveryCheck({
  openStore,
  restartDatabase,
  waitForReady,
  jobId = `live-pg-server-recovery-${randomUUID().replaceAll('-', '')}`,
  workerId = `server-recovery-worker-${process.pid}`,
  inputFingerprint = null,
  ruleSetVersion = RECOVERY_RULE_SET_VERSION,
} = {}) {
  assertFunction(openStore, 'openStore')
  assertFunction(restartDatabase, 'restartDatabase')
  assertFunction(waitForReady, 'waitForReady')
  const normalizedInputFingerprint = inputFingerprint
    ?? `live-pg-server-recovery:${jobId}`
  let beforeStore = null
  let afterStore = null
  let cleanupStore = null
  let created = false
  try {
    beforeStore = await openStore('before_restart')
    const beforeRepository = repositoryFromStore(beforeStore)
    const queuedBefore = await beforeRepository.list({ statuses: ['queued', 'retry_wait'] })
    if (queuedBefore.length) {
      throw recoveryError(
        'database_server_recovery_queue_not_empty',
        'Fixture server recovery membutuhkan PostgreSQL queue tanpa job queued lain.',
        { jobIds: queuedBefore.map(({ jobId: queuedJobId }) => queuedJobId) },
      )
    }

    const createdJob = await beforeRepository.create({
      jobId,
      jobType: RECOVERY_JOB_TYPE,
      datasetVersionId: null,
      inputFingerprint: normalizedInputFingerprint,
      ruleSetVersion,
      payload: { probe: 'postgres-server-recovery' },
      maxAttempts: 3,
    })
    if (createdJob.deduplicated === true) {
      throw recoveryError(
        'database_server_recovery_probe_exists',
        'Fingerprint probe PostgreSQL server recovery sudah dipakai job lain.',
        { jobId: createdJob.jobId, status: createdJob.status },
      )
    }
    created = true
    await closeStore(beforeStore)
    beforeStore = null

    await restartDatabase()
    await waitForReady()

    afterStore = await openStore('after_restart')
    const afterRepository = repositoryFromStore(afterStore)
    const persisted = await afterRepository.get(jobId)
    if (persisted.status !== 'queued'
      || persisted.jobId !== jobId
      || persisted.inputFingerprint !== normalizedInputFingerprint) {
      throw recoveryError(
        'database_server_recovery_job_not_durable',
        'Job probe tidak bertahan setelah PostgreSQL restart.',
        {
          status: persisted.status,
          jobId: persisted.jobId,
          inputFingerprint: persisted.inputFingerprint,
        },
      )
    }

    const claimed = await afterRepository.claimNext({
      workerId,
      leaseMilliseconds: 60_000,
    })
    if (!claimed || claimed.jobId !== jobId) {
      throw recoveryError(
        'database_server_recovery_claim_invalid',
        'Replacement worker tidak mengambil job probe yang sama setelah restart.',
        { claimedJobId: claimed?.jobId ?? null },
      )
    }
    const completed = await afterRepository.complete(jobId, workerId, {
      probe: 'postgres-server-recovery',
      recoveredAfter: 'server_restart',
    })
    if (completed.status !== 'succeeded' || completed.lockedBy !== null) {
      throw recoveryError(
        'database_server_recovery_completion_invalid',
        'Job probe tidak selesai dengan state durable yang valid.',
        {
          status: completed.status,
          lockedBy: completed.lockedBy,
        },
      )
    }

    const duplicate = await afterRepository.create({
      jobType: createdJob.jobType,
      datasetVersionId: createdJob.datasetVersionId,
      inputFingerprint: createdJob.inputFingerprint,
      ruleSetVersion: createdJob.ruleSetVersion,
      payload: createdJob.payload,
      maxAttempts: createdJob.maxAttempts,
    })
    if (duplicate.jobId !== jobId || duplicate.deduplicated !== true) {
      throw recoveryError(
        'database_server_recovery_idempotency_invalid',
        'Enqueue ulang job probe tidak mengembalikan job PostgreSQL yang sama.',
        { duplicateJobId: duplicate.jobId, deduplicated: duplicate.deduplicated },
      )
    }

    return {
      result: 'passed',
      jobId,
      workerId,
      restartCompleted: true,
      readinessConfirmed: true,
      persistedStatus: persisted.status,
      finalStatus: completed.status,
      finalAttemptCount: completed.attemptCount,
      idempotencyDeduplicated: duplicate.deduplicated,
    }
  } finally {
    let cleanupError = null
    try {
      if (created) {
        cleanupStore = afterStore ?? await openStore('cleanup')
        await deleteProbeJob(cleanupStore, jobId)
      }
    } catch (error) {
      cleanupError = error
    } finally {
      for (const store of new Set([afterStore, cleanupStore, beforeStore])) {
        try {
          await closeStore(store)
        } catch (error) {
          cleanupError ??= error
        }
      }
    }
    if (cleanupError) {
      throw recoveryError(
        'database_server_recovery_cleanup_failed',
        'Probe job PostgreSQL server recovery tidak dapat dibersihkan.',
        { cause: String(cleanupError?.message ?? cleanupError) },
      )
    }
  }
}

export function repositoryFromStore(store) {
  if (typeof store?.get !== 'function'
    || typeof store?.list !== 'function'
    || typeof store?.create !== 'function'
    || typeof store?.claimNext !== 'function'
    || typeof store?.complete !== 'function') {
    throw new TypeError(
      'Store server recovery harus menyediakan get(), list(), create(), claimNext(), dan complete().',
    )
  }
  return store
}

export async function closeStore(store) {
  if (typeof store?.close === 'function') await store.close()
}

async function deleteProbeJob(store, jobId) {
  if (typeof store?.deleteJob !== 'function') {
    throw recoveryError(
      'database_server_recovery_cleanup_unavailable',
      'Store server recovery tidak menyediakan cleanup job probe.',
    )
  }
  await store.deleteJob(jobId)
}

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`PostgreSQL server recovery membutuhkan ${name}().`)
  }
}

function recoveryError(code, message, details = undefined) {
  const error = new AppError(message, {
    code,
    statusCode: 503,
    details,
  })
  return error
}
