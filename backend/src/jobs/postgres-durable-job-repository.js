import { randomUUID } from 'node:crypto'
import { AppError } from '../errors.js'
import {
  buildIdempotencyKey,
  createDurableJob,
  normalizeDurableJob,
} from './durable-job-repository.js'

const JOB_COLUMNS = `
  schema_version, job_id, job_type, dataset_version_id,
  input_fingerprint, rule_set_version, idempotency_key, status,
  attempt_count, max_attempts, available_at, locked_by, lock_expires_at,
  started_at, last_started_at, completed_at, failed_at, progress, stage,
  cancel_requested, error_code, error_summary, payload, result, queued_at,
  created_at, updated_at, revision
`

const ACTIVE_STATUSES = Object.freeze(['queued', 'running', 'retry_wait'])
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'dead_letter', 'cancelled'])

/**
 * PostgreSQL implementation of the durable job contract.
 *
 * Claiming and every state transition use row locks plus a revisioned update,
 * so multiple application instances can share one queue without JSON lock
 * files or a process-local claim mutex.
 */
export class PostgresDurableJobRepository {
  constructor(pool, { clock = () => new Date() } = {}) {
    if (typeof pool?.query !== 'function' || typeof pool?.connect !== 'function') {
      throw new TypeError('PostgreSQL durable job repository membutuhkan pool query() dan connect().')
    }
    this.pool = pool
    this.clock = clock
  }

  async initialize() {}

  async create(input = {}) {
    const now = this.clock().toISOString()
    const normalized = createDurableJob({
      ...input,
      jobId: input.jobId ?? `job-${randomUUID()}`,
      idempotencyKey: input.idempotencyKey
        ?? buildIdempotencyKey(input),
      availableAt: input.availableAt ?? now,
      now,
    })
    return this.#withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT ${JOB_COLUMNS} FROM topology_jobs WHERE idempotency_key = $1`,
        [normalized.idempotencyKey],
      )
      if (existing.rows?.[0]) {
        return { ...rowToJob(existing.rows[0]), deduplicated: true }
      }
      try {
        const inserted = await client.query(
          `INSERT INTO topology_jobs (
             schema_version, job_id, job_type, dataset_version_id,
             input_fingerprint, rule_set_version, idempotency_key, status,
             attempt_count, max_attempts, available_at, locked_by,
             lock_expires_at, started_at, last_started_at, completed_at,
             failed_at, progress, stage, cancel_requested, error_code,
             error_summary, payload, result, queued_at, created_at,
             updated_at, revision
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb,
             $24::jsonb, $25, $26, $27, $28
           )
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING ${JOB_COLUMNS}`,
          jobValues(normalized),
        )
        if (inserted.rows?.[0]) return rowToJob(inserted.rows[0])
        const raced = await client.query(
          `SELECT ${JOB_COLUMNS} FROM topology_jobs WHERE idempotency_key = $1`,
          [normalized.idempotencyKey],
        )
        if (raced.rows?.[0]) return { ...rowToJob(raced.rows[0]), deduplicated: true }
        throw new Error('PostgreSQL tidak mengembalikan durable job yang dibuat.')
      } catch (error) {
        throw mapDatabaseError(error)
      }
    })
  }

  async get(jobId) {
    assertSafeJobId(jobId)
    const result = await this.pool.query(
      `SELECT ${JOB_COLUMNS} FROM topology_jobs WHERE job_id = $1`,
      [jobId],
    )
    if (!result.rows?.[0]) throw jobNotFound()
    return rowToJob(result.rows[0])
  }

  async list({ statuses, jobType, datasetVersionId, summary = false } = {}) {
    const conditions = []
    const values = []
    const add = (value, expression) => {
      values.push(value)
      conditions.push(expression.replace('?', `$${values.length}`))
    }
    if (statuses !== undefined) add(statuses, 'status = ANY(?::text[])')
    if (jobType) add(String(jobType), 'job_type = ?')
    if (datasetVersionId) add(String(datasetVersionId), 'dataset_version_id = ?')
    const columns = summary ? 'job_type, status' : JOB_COLUMNS
    const result = await this.pool.query(
      `SELECT ${columns}
       FROM topology_jobs
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY available_at ASC, queued_at ASC, job_id ASC`,
      values,
    )
    return summary
      ? (result.rows ?? []).map((row) => ({
        jobType: row.job_type,
        status: row.status,
      }))
      : (result.rows ?? []).map(rowToJob)
  }

  async findByIdempotencyKey(idempotencyKey) {
    const result = await this.pool.query(
      `SELECT ${JOB_COLUMNS} FROM topology_jobs WHERE idempotency_key = $1`,
      [String(idempotencyKey)],
    )
    return result.rows?.[0] ? rowToJob(result.rows[0]) : null
  }

  async update(jobId, updater, { expectedRevision } = {}) {
    assertSafeJobId(jobId)
    return this.#withTransaction(async (client) => {
      const currentResult = await client.query(
        `SELECT ${JOB_COLUMNS} FROM topology_jobs WHERE job_id = $1 FOR UPDATE`,
        [jobId],
      )
      if (!currentResult.rows?.[0]) throw jobNotFound()
      const current = rowToJob(currentResult.rows[0])
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw staleJobRevision(current, expectedRevision)
      }
      const next = typeof updater === 'function'
        ? await updater(structuredClone(current))
        : { ...current, ...updater }
      const normalized = normalizeDurableJob({
        ...next,
        jobId: current.jobId,
        revision: current.revision + 1,
        updatedAt: this.clock().toISOString(),
      })
      return updateRow(client, normalized)
    })
  }

  async claimNext({ workerId, leaseMilliseconds = 5 * 60 * 1000 } = {}) {
    const normalizedWorkerId = normalizeRequiredText(workerId, 'workerId')
    const now = this.clock()
    return this.#withTransaction(async (client) => {
      const result = await client.query(
        `SELECT ${JOB_COLUMNS}
         FROM topology_jobs
         WHERE status = ANY($1::text[])
           AND available_at <= $2
         ORDER BY available_at ASC, queued_at ASC, job_id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [['queued', 'retry_wait'], now.toISOString()],
      )
      if (!result.rows?.[0]) return null
      const current = rowToJob(result.rows[0])
      return updateRow(client, normalizeDurableJob({
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
        revision: current.revision + 1,
        updatedAt: now.toISOString(),
      }))
    })
  }

  async recoverExpiredLeases({ retryAvailableAt = this.clock().toISOString() } = {}) {
    const now = this.clock()
    return this.#withTransaction(async (client) => {
      const result = await client.query(
        `SELECT ${JOB_COLUMNS}
         FROM topology_jobs
         WHERE status = 'running'
           AND lock_expires_at IS NOT NULL
           AND lock_expires_at <= $1
         ORDER BY lock_expires_at ASC, job_id ASC
         FOR UPDATE SKIP LOCKED`,
        [now.toISOString()],
      )
      const recovered = []
      for (const row of result.rows ?? []) {
        const current = rowToJob(row)
        const exhausted = current.attemptCount >= current.maxAttempts
        recovered.push(await updateRow(client, normalizeDurableJob({
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
          stage: exhausted ? 'dead_letter' : 'retry_wait',
          revision: current.revision + 1,
          updatedAt: now.toISOString(),
        })))
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
          stage: 'cancelled',
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
      if (current.status === 'running') return { ...current, cancelRequested: true }
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
    const result = await this.pool.query(
      `SELECT EXISTS(
         SELECT 1 FROM topology_jobs WHERE status = ANY($1::text[])
       ) AS active`,
      [ACTIVE_STATUSES],
    )
    return result.rows?.[0]?.active === true || result.rows?.[0]?.active === 'true'
  }

  async #withTransaction(operation) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw mapDatabaseError(error)
    } finally {
      client.release?.()
    }
  }
}

async function updateRow(client, job) {
  const result = await client.query(
    `UPDATE topology_jobs
     SET schema_version = $1,
         job_type = $3,
         dataset_version_id = $4,
         input_fingerprint = $5,
         rule_set_version = $6,
         idempotency_key = $7,
         status = $8,
         attempt_count = $9,
         max_attempts = $10,
         available_at = $11,
         locked_by = $12,
         lock_expires_at = $13,
         started_at = $14,
         last_started_at = $15,
         completed_at = $16,
         failed_at = $17,
         progress = $18,
         stage = $19,
         cancel_requested = $20,
         error_code = $21,
         error_summary = $22,
         payload = $23::jsonb,
         result = $24::jsonb,
         queued_at = $25,
         created_at = $26,
         updated_at = $27,
         revision = $28
     WHERE job_id = $2
     RETURNING ${JOB_COLUMNS}`,
    jobValues(job),
  )
  if (!result.rows?.[0]) throw jobNotFound()
  return rowToJob(result.rows[0])
}

function jobValues(job) {
  return [
    job.schemaVersion,
    job.jobId,
    job.jobType,
    job.datasetVersionId,
    job.inputFingerprint,
    job.ruleSetVersion,
    job.idempotencyKey,
    job.status,
    job.attemptCount,
    job.maxAttempts,
    job.availableAt,
    job.lockedBy,
    job.lockExpiresAt,
    job.startedAt,
    job.lastStartedAt,
    job.completedAt,
    job.failedAt,
    job.progress,
    job.stage,
    job.cancelRequested,
    job.errorCode,
    job.errorSummary,
    JSON.stringify(job.payload ?? {}),
    job.result === null || job.result === undefined
      ? null
      : JSON.stringify(job.result),
    job.queuedAt,
    job.createdAt ?? job.queuedAt,
    job.updatedAt,
    job.revision,
  ]
}

function rowToJob(row) {
  return normalizeDurableJob({
    schemaVersion: row.schema_version,
    jobId: row.job_id,
    jobType: row.job_type,
    datasetVersionId: row.dataset_version_id ?? null,
    inputFingerprint: row.input_fingerprint,
    ruleSetVersion: row.rule_set_version ?? null,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: isoValue(row.available_at),
    lockedBy: row.locked_by ?? null,
    lockExpiresAt: isoValue(row.lock_expires_at),
    queuedAt: isoValue(row.queued_at ?? row.created_at),
    createdAt: isoValue(row.created_at),
    startedAt: isoValue(row.started_at),
    lastStartedAt: isoValue(row.last_started_at),
    completedAt: isoValue(row.completed_at),
    failedAt: isoValue(row.failed_at),
    progress: row.progress,
    stage: row.stage,
    cancelRequested: row.cancel_requested === true,
    errorCode: row.error_code ?? null,
    errorSummary: row.error_summary ?? null,
    result: jsonValue(row.result),
    payload: jsonValue(row.payload) ?? {},
    revision: row.revision,
    updatedAt: isoValue(row.updated_at),
  })
}

function jsonValue(value) {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? JSON.parse(value) : value
}

function isoValue(value) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
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

function jobNotFound() {
  return new AppError('Durable job tidak ditemukan.', {
    code: 'durable_job_not_found',
    statusCode: 404,
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

function assertSafeJobId(jobId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(jobId))) {
    throw new AppError('Identifier durable job tidak valid.', {
      code: 'durable_job_invalid_id',
      statusCode: 400,
    })
  }
}

function mapDatabaseError(error) {
  if (error instanceof AppError) return error
  if (error?.code === '23505' && error.constraint === 'topology_jobs_pkey') {
    return new AppError('Job ID sudah tersedia.', {
      code: 'durable_job_exists',
      statusCode: 409,
      cause: error,
    })
  }
  if (error?.code === '42P01' || error?.code === '42703') {
    return new AppError('Schema durable job PostgreSQL belum siap.', {
      code: 'database_schema_not_ready',
      statusCode: 503,
      cause: error,
    })
  }
  return error
}
