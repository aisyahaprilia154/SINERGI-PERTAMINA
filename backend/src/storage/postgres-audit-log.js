import { randomUUID } from 'node:crypto'

const BLOCKED_AUDIT_KEYS = /token|authorization|password|secret/i

/**
 * Append-only audit sink for PostgreSQL-primary runtime mode.
 *
 * Audit events intentionally use the same database pool as the primary
 * repository. They are not exposed as a mutable application aggregate and
 * the database trigger remains the final append-only guard.
 */
export class PostgresAuditLog {
  constructor(pool, { clock = () => new Date() } = {}) {
    if (typeof pool?.query !== 'function') {
      throw new TypeError('PostgreSQL audit log membutuhkan pool query().')
    }
    this.pool = pool
    this.clock = clock
  }

  withExecutor(executor) {
    return new PostgresAuditLog(executor, { clock: this.clock })
  }

  async record(event, {
    actorId = null,
    datasetVersionId = null,
    branchId = null,
    outcome = 'recorded',
    correlationId = null,
    details = {},
  } = {}, { executor = this.pool } = {}) {
    const entry = {
      id: randomUUID(),
      event: normalizeText(event, 'event'),
      actorId: nullableText(actorId),
      datasetVersionId: nullableText(datasetVersionId),
      branchId: nullableText(branchId),
      outcome: normalizeText(outcome, 'outcome'),
      correlationId: nullableText(correlationId),
      occurredAt: this.clock().toISOString(),
      details: sanitizeAuditDetails(details),
    }
    await executor.query(
      `INSERT INTO audit_events (
         event_id, event, actor_id, dataset_version_id, branch_id,
         outcome, correlation_id, occurred_at, details
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        entry.id,
        entry.event,
        entry.actorId,
        entry.datasetVersionId,
        entry.branchId,
        entry.outcome,
        entry.correlationId,
        entry.occurredAt,
        JSON.stringify(entry.details),
      ],
    )
    return entry
  }
}

function sanitizeAuditDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !BLOCKED_AUDIT_KEYS.test(key))
      .map(([key, value]) => [key, cloneJsonValue(value)]),
  )
}

function cloneJsonValue(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return '[unserializable]'
  }
}

function normalizeText(value, field) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`Audit ${field} tidak valid.`)
  }
  return normalized
}

function nullableText(value) {
  if (value === null || value === undefined || value === '') return null
  return normalizeText(value, 'value')
}
