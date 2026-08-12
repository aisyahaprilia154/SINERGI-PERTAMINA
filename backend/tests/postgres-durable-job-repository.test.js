import assert from 'node:assert/strict'
import test from 'node:test'
import { PostgresDurableJobRepository } from '../src/jobs/postgres-durable-job-repository.js'

test('PostgreSQL durable job summary listing does not select large job results', async () => {
  const pool = new FakePool()
  const repository = new PostgresDurableJobRepository(pool)

  const jobs = await repository.list({ summary: true })

  assert.deepEqual(jobs, [{ jobType: 'parse_source', status: 'succeeded' }])
  assert.match(pool.sql, /SELECT\s+job_type, status\s+FROM topology_jobs/s)
  assert.doesNotMatch(pool.sql, /result|payload|input_fingerprint/)
})

class FakePool {
  async query(sql) {
    this.sql = sql
    return { rows: [{ job_type: 'parse_source', status: 'succeeded' }] }
  }

  async connect() {
    return { query: (...args) => this.query(...args), release() {} }
  }
}
