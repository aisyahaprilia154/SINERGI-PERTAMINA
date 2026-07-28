import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export class JsonLinesAuditLog {
  constructor(filePath, { clock = () => new Date() } = {}) {
    this.filePath = path.resolve(filePath)
    this.clock = clock
  }

  async record(event, {
    actorId = null,
    datasetVersionId = null,
    branchId = null,
    outcome,
    details = {},
  } = {}) {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const entry = {
      id: crypto.randomUUID(),
      event,
      actorId,
      datasetVersionId,
      branchId,
      outcome: outcome ?? 'recorded',
      occurredAt: this.clock().toISOString(),
      details: sanitizeAuditDetails(details),
    }
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' })
    return entry
  }
}

function sanitizeAuditDetails(details) {
  const blockedKeys = /token|authorization|password|secret/i
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => !blockedKeys.test(key)),
  )
}
