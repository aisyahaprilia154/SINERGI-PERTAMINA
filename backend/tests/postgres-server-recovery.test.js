import assert from 'node:assert/strict'
import test from 'node:test'
import {
  runLivePostgresServerRecovery,
} from '../scripts/database-postgres-server-recovery.mjs'
import {
  runPostgresServerRecoveryCheck,
} from '../src/database/postgres-server-recovery.js'

test('server recovery orchestration reopens a durable store after restart', async () => {
  const state = {
    jobs: new Map(),
    restartCalls: 0,
    readyCalls: 0,
    phases: [],
    closeCalls: 0,
  }
  const result = await runPostgresServerRecoveryCheck({
    openStore: async (phase) => {
      state.phases.push(phase)
      return new FakeStore(state)
    },
    restartDatabase: async () => {
      state.restartCalls += 1
    },
    waitForReady: async () => {
      state.readyCalls += 1
      assert.equal(state.restartCalls, 1)
    },
    jobId: 'server-recovery-contract-1',
    workerId: 'server-recovery-contract-worker',
  })

  assert.deepEqual(result, {
    result: 'passed',
    jobId: 'server-recovery-contract-1',
    workerId: 'server-recovery-contract-worker',
    restartCompleted: true,
    readinessConfirmed: true,
    persistedStatus: 'queued',
    finalStatus: 'succeeded',
    finalAttemptCount: 1,
    idempotencyDeduplicated: true,
  })
  assert.deepEqual(state.phases, ['before_restart', 'after_restart'])
  assert.equal(state.restartCalls, 1)
  assert.equal(state.readyCalls, 1)
  assert.equal(state.closeCalls, 2)
  assert.equal(state.jobs.size, 0)
})

test('server recovery fixture fails closed when another queued job exists', async () => {
  const state = {
    jobs: new Map([
      ['other-job', {
        jobId: 'other-job',
        status: 'queued',
      }],
    ]),
    restartCalls: 0,
  }
  await assert.rejects(
    runPostgresServerRecoveryCheck({
      openStore: async () => new FakeStore(state),
      restartDatabase: async () => {
        state.restartCalls += 1
      },
      waitForReady: async () => {},
      jobId: 'server-recovery-contract-2',
    }),
    (error) => error.code === 'database_server_recovery_queue_not_empty',
  )
  assert.equal(state.restartCalls, 0)
  assert.equal(state.jobs.has('other-job'), true)
})

test('server recovery does not delete a pre-existing deduplicated probe', async () => {
  const state = {
    jobs: new Map(),
    restartCalls: 0,
  }
  const existingStore = new FakeStore(state)
  await existingStore.create({
    jobId: 'old-probe',
    jobType: 'parse_source',
    inputFingerprint: 'reused-probe-fingerprint',
    ruleSetVersion: 'postgres-server-recovery/1.0.0',
    payload: { probe: 'old' },
  })
  state.jobs.get('old-probe').status = 'succeeded'

  await assert.rejects(
    runPostgresServerRecoveryCheck({
      openStore: async () => new FakeStore(state),
      restartDatabase: async () => {
        state.restartCalls += 1
      },
      waitForReady: async () => {},
      jobId: 'server-recovery-contract-existing',
      inputFingerprint: 'reused-probe-fingerprint',
    }),
    (error) => error.code === 'database_server_recovery_probe_exists',
  )
  assert.equal(state.restartCalls, 0)
  assert.equal(state.jobs.has('old-probe'), true)
  assert.equal(state.jobs.get('old-probe').status, 'succeeded')
})

test('server recovery cleans its probe through a fresh store when restart fails', async () => {
  const state = {
    jobs: new Map(),
    phases: [],
    closeCalls: 0,
  }
  await assert.rejects(
    runPostgresServerRecoveryCheck({
      openStore: async (phase) => {
        state.phases.push(phase)
        return new FakeStore(state)
      },
      restartDatabase: async () => {
        throw Object.assign(new Error('injected restart failure'), {
          code: 'restart_failed',
        })
      },
      waitForReady: async () => {},
      jobId: 'server-recovery-contract-cleanup',
    }),
    (error) => error.code === 'restart_failed',
  )
  assert.deepEqual(state.phases, ['before_restart', 'cleanup'])
  assert.equal(state.jobs.size, 0)
  assert.equal(state.closeCalls, 2)
})

test('live server recovery rejects missing credentials before opening or restarting', async () => {
  let restartCalled = false
  await assert.rejects(
    runLivePostgresServerRecovery({
      restartDatabase: async () => {
        restartCalled = true
      },
      waitForReady: async () => {},
    }),
    (error) => error.code === 'database_url_required',
  )
  assert.equal(restartCalled, false)
})

class FakeStore {
  constructor(state) {
    this.state = state
  }

  async list({ statuses } = {}) {
    const allowed = statuses ? new Set(statuses) : null
    return [...this.state.jobs.values()]
      .filter((job) => !allowed || allowed.has(job.status))
      .map((job) => structuredClone(job))
  }

  async create(input) {
    const idempotencyKey = [
      input.jobType,
      input.datasetVersionId ?? '',
      input.inputFingerprint,
      input.ruleSetVersion ?? '',
    ].join(':')
    const existing = [...this.state.jobs.values()]
      .find((job) => job.idempotencyKey === idempotencyKey)
    if (existing) return { ...structuredClone(existing), deduplicated: true }
    const job = {
      jobId: input.jobId ?? `job-${this.state.jobs.size + 1}`,
      jobType: input.jobType,
      datasetVersionId: input.datasetVersionId ?? null,
      inputFingerprint: input.inputFingerprint,
      ruleSetVersion: input.ruleSetVersion ?? null,
      idempotencyKey,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 3,
      lockedBy: null,
      payload: structuredClone(input.payload ?? {}),
    }
    this.state.jobs.set(job.jobId, job)
    return structuredClone(job)
  }

  async get(jobId) {
    const job = this.state.jobs.get(jobId)
    if (!job) throw new Error(`missing fake job ${jobId}`)
    return structuredClone(job)
  }

  async claimNext({ workerId }) {
    const job = [...this.state.jobs.values()].find(({ status }) => (
      status === 'queued' || status === 'retry_wait'
    ))
    if (!job) return null
    job.status = 'running'
    job.attemptCount += 1
    job.lockedBy = workerId
    return structuredClone(job)
  }

  async complete(jobId, workerId, result) {
    const job = this.state.jobs.get(jobId)
    if (!job || job.status !== 'running' || job.lockedBy !== workerId) {
      throw new Error('fake lease lost')
    }
    job.status = 'succeeded'
    job.lockedBy = null
    job.result = structuredClone(result)
    return structuredClone(job)
  }

  async deleteJob(jobId) {
    this.state.jobs.delete(jobId)
  }

  async close() {
    this.state.closeCalls = (this.state.closeCalls ?? 0) + 1
  }
}
