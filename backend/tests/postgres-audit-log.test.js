import assert from 'node:assert/strict'
import test from 'node:test'
import { PostgresAuditLog } from '../src/storage/postgres-audit-log.js'

test('PostgreSQL audit log writes sanitized append-only event rows', async () => {
  const calls = []
  const log = new PostgresAuditLog({
    async query(text, values) {
      calls.push({ text, values })
      return { rows: [] }
    },
  }, { clock: () => new Date('2026-08-04T03:04:05.000Z') })

  const event = await log.record('topology.reviewed', {
    actorId: 'admin-1',
    datasetVersionId: 'dv-1',
    branchId: 'branch-1',
    outcome: 'confirmed',
    details: {
      candidateId: 'candidate-1',
      password: 'must-not-persist',
    },
  })

  assert.equal(event.event, 'topology.reviewed')
  assert.equal(event.occurredAt, '2026-08-04T03:04:05.000Z')
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /INSERT INTO audit_events/)
  const details = JSON.parse(calls[0].values.at(-1))
  assert.deepEqual(details, { candidateId: 'candidate-1' })
})
