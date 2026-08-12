import { randomUUID } from 'node:crypto'
import { sanitizeAuditDetails } from './audit-sanitizer.js'

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
    eventId = null,
    actorId = null,
    datasetVersionId = null,
    branchId = null,
    outcome = 'recorded',
    correlationId = null,
    details = {},
  } = {}, { executor = this.pool } = {}) {
    const entry = {
      id: eventId ?? randomUUID(),
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
