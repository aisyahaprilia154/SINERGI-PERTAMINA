import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expectedConstraintViolation,
  runForeignKeyProbe,
  runUniqueCandidateProbe,
} from '../scripts/database-constraint-negative.mjs'

test('constraint probe accepts the expected PostgreSQL FK and unique violations', () => {
  assert.deepEqual(
    expectedConstraintViolation({
      code: '23503',
      constraint: 'topology_candidates_dataset_version_id_fkey',
    }, {
      operation: 'foreign_key_dataset_version',
      sqlState: '23503',
      constraintPattern: /topology_candidates.*dataset_version/i,
    }),
    {
      passed: true,
      operation: 'foreign_key_dataset_version',
      sqlState: '23503',
      constraint: 'topology_candidates_dataset_version_id_fkey',
    },
  )
  assert.throws(
    () => expectedConstraintViolation({
      code: '23505',
      constraint: 'wrong_constraint',
    }, {
      operation: 'foreign_key_dataset_version',
      sqlState: '23503',
      constraintPattern: /topology_candidates.*dataset_version/i,
    }),
    (error) => error.code === 'database_constraint_probe_unexpected_error',
  )
})

test('constraint probes always roll back their savepoints', async () => {
  const foreignKeyClient = new ProbeClient({
    violation: {
      code: '23503',
      constraint: 'topology_candidates_dataset_version_id_fkey',
    },
  })
  const foreignKey = await runForeignKeyProbe(foreignKeyClient)
  assert.equal(foreignKey.passed, true)
  assert.deepEqual(foreignKeyClient.commands.slice(-2), [
    'ROLLBACK TO SAVEPOINT constraint_fk_probe',
    'RELEASE SAVEPOINT constraint_fk_probe',
  ])

  const uniqueClient = new ProbeClient({
    violation: {
      code: '23505',
      constraint: 'topology_candidates_dataset_version_id_candidate_id_key',
    },
  })
  const unique = await runUniqueCandidateProbe(
    uniqueClient,
    'dv-pilot-parity',
    'constraint-negative-test',
  )
  assert.equal(unique.passed, true)
  assert.deepEqual(uniqueClient.commands.slice(-2), [
    'ROLLBACK TO SAVEPOINT constraint_unique_probe',
    'RELEASE SAVEPOINT constraint_unique_probe',
  ])
})

class ProbeClient {
  constructor({ violation }) {
    this.violation = violation
    this.commands = []
    this.insertCount = 0
  }

  async query(query) {
    const text = typeof query === 'string' ? query : query.text
    this.commands.push(text)
    if (text.startsWith('INSERT INTO topology_candidates')) {
      this.insertCount += 1
      if (this.violation && this.insertCount === (this.violation.code === '23505' ? 2 : 1)) {
        throw this.violation
      }
    }
    return { rows: [] }
  }
}
