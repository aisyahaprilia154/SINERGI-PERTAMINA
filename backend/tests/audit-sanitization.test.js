import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JsonLinesAuditLog } from '../src/storage/audit-log.js'
import { PostgresAuditLog } from '../src/storage/postgres-audit-log.js'

test('JSON audit sanitization removes nested secrets and bounds cycles', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-audit-sanitize-'))
  try {
    const auditLog = new JsonLinesAuditLog(path.join(root, 'audit.jsonl'))
    const circular = { safe: 'kept' }
    circular.self = circular
    await auditLog.record('security.test', {
      actorId: 'operator-test',
      details: {
        safe: { nested: true },
        credentials: {
          password: 'removed',
          nested: { authorization: 'removed', value: 'kept' },
        },
        circular,
      },
    })

    const entry = JSON.parse((await readFile(path.join(root, 'audit.jsonl'), 'utf8')).trim())
    assert.deepEqual(entry.details, {
      safe: { nested: true },
      credentials: { nested: { value: 'kept' } },
      circular: { safe: 'kept', self: '[circular]' },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('PostgreSQL audit sanitization removes nested secrets before JSONB insert', async () => {
  const calls = []
  const log = new PostgresAuditLog({
    async query(text, values) {
      calls.push({ text, values })
      return { rows: [] }
    },
  })

  await log.record('security.test', {
    details: {
      safe: { value: 'kept' },
      nested: [{ token: 'removed', value: 'kept' }],
    },
  })

  assert.deepEqual(JSON.parse(calls[0].values.at(-1)), {
    safe: { value: 'kept' },
    nested: [{ value: 'kept' }],
  })
})
