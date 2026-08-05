import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
  rename,
} from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

export const DURABLE_JOB_SCHEMA_VERSION = '1.0.0'

export const DURABLE_JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'dead_letter',
  'cancelled',
])

const ACTIVE_STATUSES = new Set(['queued', 'running', 'retry_wait'])
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'dead_letter', 'cancelled'])

export class JsonDurableJobRepository {
  constructor(rootDirectory, {
    staleLockMilliseconds = 5 * 60 * 1000,
    clock = () => new Date(),
  } = {}) {
    this.rootDirectory = path.resolve(rootDirectory)
    this.lockDirectory = path.join(this.rootDirectory, '.locks')
    this.staleLockMilliseconds = staleLockMilliseconds
    this.clock = clock
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true })
    await mkdir(this.lockDirectory, { recursive: true })
  }

  async create({
    jobId = `job-${randomUUID()}`,
    jobType,
    datasetVersionId = null,
    inputFingerprint,
    ruleSetVersion = null,
    idempotencyKey,
    payload = {},
    maxAttempts = 3,
    availableAt = this.clock().toISOString(),
  }) {
    await this.initialize()
    const normalized = normalizeJob({
      jobId,
      jobType,
      datasetVersionId,
      inputFingerprint,
      ruleSetVersion,
      idempotencyKey: idempotencyKey
        ?? buildIdempotencyKey({
          jobType,
          datasetVersionId,
          inputFingerprint,
          ruleSetVersion,
        }),
      payload,
      maxAttempts,
      availableAt,
      now: this.clock().toISOString(),
    })
    return this.#withLock(
      this.#idempotencyLockPath(normalized.idempotencyKey),
      async () => {
        const existing = await this.findByIdempotencyKey(normalized.idempotencyKey)
        if (existing) return { ...structuredClone(existing), deduplicated: true }
        try {
          await writeFile(
            this.#pathFor(normalized.jobId),
            JSON.stringify(normalized, null, 2),
            { encoding: 'utf8', flag: 'wx' },
          )
        } catch (error) {
          if (error.code === 'EEXIST') {
            throw new AppError('Job ID sudah tersedia.', {
              code: 'durable_job_exists',
              statusCode: 409,
            })
          }
          throw error
        }
        return structuredClone(normalized)
      },
    )
  }

  async get(jobId) {
    return this.#withLock(this.#claimLockPath(), () => this.#getWithoutLock(jobId))
  }

  async list({ statuses, jobType, datasetVersionId } = {}) {
    return this.#withLock(this.#claimLockPath(), () => this.#listWithoutLock({
      statuses,
      jobType,
      datasetVersionId,
    }))
  }

  async findByIdempotencyKey(idempotencyKey) {
    const jobs = await this.list()
    return jobs.find((job) => job.idempotencyKey === idempotencyKey) ?? null
  }

  async update(jobId, updater, { expectedRevision } = {}) {
    return this.#withLock(this.#claimLockPath(), () => (
      this.#updateWithJobLock(jobId, updater, { expectedRevision })
    ))
  }

  async #listWithoutLock({ statuses, jobType, datasetVersionId } = {}) {
    await this.initialize()
    const allowedStatuses = statuses
      ? new Set(statuses)
      : null
    const entries = await readdir(this.rootDirectory, { withFileTypes: true })
    const jobs = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const job = normalizePersistedJob(JSON.parse(await readFile(
        path.join(this.rootDirectory, entry.name),
        'utf8',
      )))
      if (allowedStatuses && !allowedStatuses.has(job.status)) continue
      if (jobType && job.jobType !== jobType) continue
      if (datasetVersionId && job.datasetVersionId !== datasetVersionId) continue
      jobs.push(job)
    }
    return jobs.sort((left, right) => (
      String(left.availableAt).localeCompare(String(right.availableAt))
      || String(left.queuedAt).localeCompare(String(right.queuedAt))
      || left.jobId.localeCompare(right.jobId)
    ))
  }

  async #getWithoutLock(jobId) {
    assertSafeJobId(jobId)
    try {
      return normalizePersistedJob(JSON.parse(await readFile(this.#pathFor(jobId), 'utf8')))
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('Durable job tidak ditemukan.', {
          code: 'durable_job_not_found',
          statusCode: 404,
        })
      }
      throw error
    }
  }

  async #updateWithJobLock(jobId, updater, { expectedRevision } = {}) {
    return this.#withLock(this.#jobLockPath(jobId), async () => {
      const current = await this.#getWithoutLock(jobId)
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw staleJobRevision(current, expectedRevision)
      }
      const next = typeof updater === 'function'
        ? await updater(structuredClone(current))
        : { ...current, ...updater }
      const normalized = normalizePersistedJob({
        ...next,
        jobId: current.jobId,
        revision: current.revision + 1,
        updatedAt: this.clock().toISOString(),
      })
      await this.#writeAtomic(normalized)
      return structuredClone(normalized)
    })
  }

  async claimNext({ workerId, leaseMilliseconds = 5 * 60 * 1000 } = {}) {
    const normalizedWorkerId = normalizeRequiredText(workerId, 'workerId')
    const now = this.clock()
    return this.#withLock(this.#claimLockPath(), async () => {
      const available = (await this.#listWithoutLock({
        statuses: ['queued', 'retry_wait'],
      })).filter((job) => Date.parse(job.availableAt) <= now.getTime())
      const next = available[0]
      if (!next) return null
      return this.#updateWithoutLock(next.jobId, (current) => ({
        ...current,
        status: 'running',
        attemptCount: current.attemptCount + 1,
        lockedBy: normalizedWorkerId,
        lockExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString(),
        startedAt: current.startedAt ?? now.toISOString(),
        lastStartedAt: now.toISOString(),
        cancelRequested: false,
        errorCode: null,
        errorSummary: null,
      }))
    })
  }

  async recoverExpiredLeases({ retryAvailableAt = this.clock().toISOString() } = {}) {
    const now = this.clock()
    return this.#withLock(this.#claimLockPath(), async () => {
      const running = await this.#listWithoutLock({ statuses: ['running'] })
      const expired = running.filter((job) => (
        job.lockExpiresAt && Date.parse(job.lockExpiresAt) <= now.getTime()
      ))
      const recovered = []
      for (const job of expired) {
        recovered.push(await this.#updateWithoutLock(job.jobId, (current) => {
          const exhausted = current.attemptCount >= current.maxAttempts
          return {
            ...current,
            status: exhausted ? 'dead_letter' : 'retry_wait',
            availableAt: exhausted ? current.availableAt : retryAvailableAt,
            lockedBy: null,
            lockExpiresAt: null,
            errorCode: exhausted ? 'lease_expired_max_attempts' : 'lease_expired',
            errorSummary: exhausted
              ? 'Worker lease kedaluwarsa setelah maksimum percobaan.'
              : 'Worker lease kedaluwarsa; job dikembalikan ke antrean.',
            completedAt: exhausted ? now.toISOString() : null,
          }
        }))
      }
      return recovered
    })
  }

  async renew(jobId, workerId, leaseMilliseconds = 5 * 60 * 1000) {
    const now = this.clock()
    return this.update(jobId, (current) => {
      assertOwnedRunningJob(current, workerId)
      return {
        ...current,
        lockExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString(),
      }
    })
  }

  async complete(jobId, workerId, result = null) {
    const completedAt = this.clock().toISOString()
    return this.update(jobId, (current) => {
      assertOwnedRunningJob(current, workerId)
      if (current.cancelRequested) {
        return {
          ...current,
          status: 'cancelled',
          lockedBy: null,
          lockExpiresAt: null,
          completedAt,
          cancelRequested: false,
        }
      }
      return {
        ...current,
        status: 'succeeded',
        lockedBy: null,
        lockExpiresAt: null,
        completedAt,
        progress: 100,
        stage: 'succeeded',
        result: result === undefined ? null : structuredClone(result),
      }
    })
  }

  async fail(jobId, workerId, {
    errorCode = 'durable_job_failed',
    errorSummary = 'Durable job gagal.',
    retryable = true,
    retryAt,
  } = {}) {
    const failedAt = this.clock().toISOString()
    return this.update(jobId, (current) => {
      assertOwnedRunningJob(current, workerId)
      const exhausted = current.attemptCount >= current.maxAttempts
      const deadLetter = !retryable || exhausted
      return {
        ...current,
        status: deadLetter ? 'dead_letter' : 'retry_wait',
        availableAt: deadLetter
          ? current.availableAt
          : retryAt ?? new Date(this.clock().getTime() + backoffMilliseconds(
            current.attemptCount,
          )).toISOString(),
        lockedBy: null,
        lockExpiresAt: null,
        failedAt,
        completedAt: deadLetter ? failedAt : null,
        errorCode,
        errorSummary: String(errorSummary).slice(0, 1000),
        stage: deadLetter ? 'dead_letter' : 'retry_wait',
      }
    })
  }

  async isCancelRequested(jobId) {
    return (await this.get(jobId)).cancelRequested === true
  }

  async requestCancel(jobId) {
    const now = this.clock().toISOString()
    return this.update(jobId, (current) => {
      if (TERMINAL_STATUSES.has(current.status)) return current
      if (current.status === 'running') {
        return { ...current, cancelRequested: true }
      }
      return {
        ...current,
        status: 'cancelled',
        completedAt: now,
        stage: 'cancelled',
      }
    })
  }

  async retry(jobId) {
    const now = this.clock().toISOString()
    return this.update(jobId, (current) => {
      if (!['failed', 'dead_letter', 'cancelled'].includes(current.status)) {
        throw new AppError('Job belum berada pada state yang dapat diulang.', {
          code: 'durable_job_not_retryable',
          statusCode: 409,
          details: { status: current.status },
        })
      }
      return {
        ...current,
        status: 'queued',
        attemptCount: 0,
        availableAt: now,
        lockedBy: null,
        lockExpiresAt: null,
        startedAt: null,
        lastStartedAt: null,
        completedAt: null,
        failedAt: null,
        cancelRequested: false,
        progress: 0,
        stage: 'queued',
        errorCode: null,
        errorSummary: null,
        result: null,
      }
    })
  }

  async hasActiveJobs() {
    return this.#withLock(this.#claimLockPath(), async () => {
      const jobs = await this.#listWithoutLock()
      return jobs.some((job) => ACTIVE_STATUSES.has(job.status))
    })
  }

  async #updateWithoutLock(jobId, updater) {
    return this.#withLock(this.#jobLockPath(jobId), async () => {
      const current = await this.#getWithoutLock(jobId)
      const next = await updater(structuredClone(current))
      const normalized = normalizePersistedJob({
        ...next,
        jobId: current.jobId,
        revision: current.revision + 1,
        updatedAt: this.clock().toISOString(),
      })
      await this.#writeAtomic(normalized)
      return structuredClone(normalized)
    })
  }

  async #writeAtomic(job) {
    const target = this.#pathFor(job.jobId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(job, null, 2), 'utf8')
    await rename(temporary, target)
  }

  async #withLock(lockPath, operation) {
    await this.initialize()
    const token = randomUUID()
    while (true) {
      try {
        await writeFile(lockPath, JSON.stringify({
          token,
          acquiredAt: this.clock().toISOString(),
        }), { encoding: 'utf8', flag: 'wx' })
        break
      } catch (error) {
        if (!isRetryableLockError(error)) throw error
        if (error.code === 'EEXIST' && await this.#isStaleLock(lockPath)) {
          await removeLockFile(lockPath)
        }
        await delay(5)
      }
    }

    try {
      return await operation()
    } finally {
      let lock = null
      try {
        lock = JSON.parse(await readFile(lockPath, 'utf8'))
      } catch {
        // Another process may have recovered a stale lock after an abrupt exit.
      }
      if (lock?.token === token) await removeLockFile(lockPath)
    }
  }

  async #isStaleLock(lockPath) {
    try {
      const info = await stat(lockPath)
      return this.clock().getTime() - info.mtimeMs > this.staleLockMilliseconds
    } catch (error) {
      return error.code === 'ENOENT' ? false : false
    }
  }

  #pathFor(jobId) {
    assertSafeJobId(jobId)
    return path.join(this.rootDirectory, `${jobId}.json`)
  }

  #claimLockPath() {
    return path.join(this.lockDirectory, 'claim.lock')
  }

  #idempotencyLockPath(idempotencyKey) {
    const digest = createHash('sha256').update(idempotencyKey).digest('hex')
    return path.join(this.lockDirectory, `idempotency-${digest}.lock`)
  }

  #jobLockPath(jobId) {
    assertSafeJobId(jobId)
    return path.join(this.lockDirectory, `job-${jobId}.lock`)
  }
}

export function buildIdempotencyKey({
  jobType,
  datasetVersionId,
  inputFingerprint,
  ruleSetVersion,
}) {
  return createHash('sha256')
    .update([
      jobType ?? '',
      datasetVersionId ?? '',
      inputFingerprint ?? '',
      ruleSetVersion ?? '',
    ].join('|'))
    .digest('hex')
}

export function createDurableJob(input) {
  return normalizeJob(input)
}

export function normalizeDurableJob(input) {
  return normalizePersistedJob(input)
}

export function publicDurableJob(job) {
  return {
    jobId: job.jobId,
    jobType: job.jobType,
    datasetVersionId: job.datasetVersionId,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    progress: job.progress,
    stage: job.stage,
    errorCode: job.errorCode,
    errorSummary: job.errorSummary,
    cancelRequested: job.cancelRequested,
    revision: job.revision,
  }
}

function normalizeJob(input) {
  const now = input.now ?? new Date().toISOString()
  const job = {
    schemaVersion: DURABLE_JOB_SCHEMA_VERSION,
    jobId: normalizeRequiredText(input.jobId, 'jobId'),
    jobType: normalizeRequiredText(input.jobType, 'jobType'),
    datasetVersionId: input.datasetVersionId === null
      ? null
      : normalizeRequiredText(input.datasetVersionId, 'datasetVersionId'),
    inputFingerprint: normalizeRequiredText(input.inputFingerprint, 'inputFingerprint'),
    ruleSetVersion: input.ruleSetVersion ? String(input.ruleSetVersion) : null,
    idempotencyKey: normalizeRequiredText(input.idempotencyKey, 'idempotencyKey'),
    payload: structuredClone(input.payload ?? {}),
    status: 'queued',
    attemptCount: 0,
    maxAttempts: positiveInteger(input.maxAttempts, 3),
    availableAt: validIso(input.availableAt, 'availableAt'),
    lockedBy: null,
    lockExpiresAt: null,
    queuedAt: now,
    startedAt: null,
    lastStartedAt: null,
    completedAt: null,
    failedAt: null,
    progress: 0,
    stage: 'queued',
    cancelRequested: false,
    errorCode: null,
    errorSummary: null,
    result: null,
    revision: 0,
    updatedAt: now,
  }
  return normalizePersistedJob(job)
}

function normalizePersistedJob(input) {
  if (!input || typeof input !== 'object') {
    throw new AppError('Durable job tidak valid.', {
      code: 'durable_job_corrupt',
      statusCode: 500,
    })
  }
  if (input.schemaVersion !== DURABLE_JOB_SCHEMA_VERSION) {
    throw new AppError('Versi schema durable job tidak didukung.', {
      code: 'durable_job_schema_unsupported',
      statusCode: 500,
    })
  }
  if (!DURABLE_JOB_STATUSES.includes(input.status)) {
    throw new AppError('Status durable job tidak valid.', {
      code: 'durable_job_corrupt',
      statusCode: 500,
    })
  }
  return {
    ...structuredClone(input),
    jobId: normalizeRequiredText(input.jobId, 'jobId'),
    jobType: normalizeRequiredText(input.jobType, 'jobType'),
    inputFingerprint: normalizeRequiredText(input.inputFingerprint, 'inputFingerprint'),
    idempotencyKey: normalizeRequiredText(input.idempotencyKey, 'idempotencyKey'),
    payload: structuredClone(input.payload ?? {}),
    attemptCount: nonNegativeInteger(input.attemptCount, 0),
    maxAttempts: positiveInteger(input.maxAttempts, 3),
    progress: boundedNumber(input.progress, 0, 0, 100),
    revision: nonNegativeInteger(input.revision, 0),
  }
}

function assertOwnedRunningJob(job, workerId) {
  if (job.status !== 'running' || job.lockedBy !== workerId) {
    throw new AppError('Durable job bukan milik worker ini.', {
      code: 'durable_job_lease_lost',
      statusCode: 409,
      details: { status: job.status },
    })
  }
}

function staleJobRevision(job, expectedRevision) {
  return new AppError('Durable job berubah sejak dibaca.', {
    code: 'durable_job_stale_revision',
    statusCode: 409,
    details: {
      jobId: job.jobId,
      expectedRevision,
      currentRevision: job.revision,
    },
  })
}

function backoffMilliseconds(attemptCount) {
  return Math.min(60 * 60 * 1000, 1000 * (2 ** Math.max(0, attemptCount - 1)))
}

function normalizeRequiredText(value, field) {
  const text = String(value ?? '').trim()
  if (!text || text.length > 512 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AppError(`Field durable job ${field} tidak valid.`, {
      code: 'durable_job_invalid_field',
      statusCode: 400,
      details: { field },
    })
  }
  return text
}

function validIso(value, field) {
  const text = String(value ?? '')
  if (!Number.isFinite(Date.parse(text))) {
    throw new AppError(`Field durable job ${field} tidak valid.`, {
      code: 'durable_job_invalid_field',
      statusCode: 400,
      details: { field },
    })
  }
  return new Date(text).toISOString()
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : fallback
}

function assertSafeJobId(jobId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(jobId))) {
    throw new AppError('Identifier durable job tidak valid.', {
      code: 'durable_job_invalid_id',
      statusCode: 400,
    })
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref?.()
  })
}

function isRetryableLockError(error) {
  return ['EEXIST', 'EPERM', 'EBUSY', 'EACCES'].includes(error?.code)
}

async function removeLockFile(lockPath) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await unlink(lockPath)
      return
    } catch (error) {
      if (error.code === 'ENOENT') return
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) return
      await delay(5)
    }
  }
}
