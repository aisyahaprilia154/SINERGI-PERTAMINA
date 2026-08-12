import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { sanitizeAuditDetails } from './audit-sanitizer.js'

export class JsonLinesAuditLog {
  constructor(filePath, { clock = () => new Date() } = {}) {
    this.filePath = path.resolve(filePath)
    this.clock = clock
  }

  async record(event, {
    eventId = null,
    actorId = null,
    datasetVersionId = null,
    branchId = null,
    correlationId = null,
    outcome,
    details = {},
  } = {}) {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const entry = {
      id: eventId ?? crypto.randomUUID(),
      event,
      actorId,
      datasetVersionId,
      branchId,
      correlationId: normalizeCorrelationId(correlationId),
      outcome: outcome ?? 'recorded',
      occurredAt: this.clock().toISOString(),
      details: sanitizeAuditDetails(details),
    }
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' })
    return entry
  }
}

function normalizeCorrelationId(value) {
  if (value === null || value === undefined || value === '') return null
  const normalized = String(value).trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(normalized)) return null
  return normalized
}
