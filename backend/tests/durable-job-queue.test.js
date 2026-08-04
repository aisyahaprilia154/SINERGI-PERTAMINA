import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DurableJobQueue } from '../src/jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from '../src/jobs/durable-job-repository.js'

test('durable job survives queue lifecycle, reports progress, and deduplicates idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-job-'))
  const repository = new JsonDurableJobRepository(root)
  const queue = new DurableJobQueue({
    repository,
    workerId: 'worker-a',
    pollMilliseconds: 10,
    leaseMilliseconds: 10000,
  })
  queue.registerHandler('unit_work', async (payload, { updateProgress }) => {
    assert.equal(payload.input, 'fixture')
    await updateProgress(50, 'halfway')
    return { output: 'ok' }
  })

  try {
    await queue.start()
    const first = await queue.enqueue({
      jobType: 'unit_work',
      datasetVersionId: 'dv-job-test',
      inputFingerprint: 'sha256:fixture',
      ruleSetVersion: 'rule/1.0.0',
      payload: { input: 'fixture' },
    })
    const duplicate = await queue.enqueue({
      jobType: 'unit_work',
      datasetVersionId: 'dv-job-test',
      inputFingerprint: 'sha256:fixture',
      ruleSetVersion: 'rule/1.0.0',
      payload: { input: 'fixture' },
    })

    assert.equal(duplicate.jobId, first.jobId)
    assert.equal(duplicate.deduplicated, true)
    await queue.onIdle()

    const completed = await repository.get(first.jobId)
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.attemptCount, 1)
    assert.equal(completed.progress, 100)
    assert.equal(completed.stage, 'succeeded')
    assert.deepEqual(completed.result, { output: 'ok' })
    assert.equal(completed.lockedBy, null)
  } finally {
    await queue.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('expired worker lease is recovered and executed by the next worker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-recovery-'))
  const repository = new JsonDurableJobRepository(root)
  const queue = new DurableJobQueue({
    repository,
    workerId: 'worker-replacement',
    pollMilliseconds: 10,
    leaseMilliseconds: 60000,
  })

  try {
    const created = await repository.create({
      jobType: 'recoverable',
      datasetVersionId: 'dv-recovery-test',
      inputFingerprint: 'sha256:recover',
      payload: {},
      maxAttempts: 3,
    })
    const claimed = await repository.claimNext({
      workerId: 'worker-crashed',
      leaseMilliseconds: 10,
    })
    assert.equal(claimed.jobId, created.jobId)
    await wait(30)

    const recovered = await repository.recoverExpiredLeases({
      retryAvailableAt: new Date().toISOString(),
    })
    assert.equal(recovered[0].status, 'retry_wait')
    assert.equal(recovered[0].errorCode, 'lease_expired')

    queue.registerHandler('recoverable', async () => 'recovered')
    await queue.start()
    await queue.onIdle()

    const completed = await repository.get(created.jobId)
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.attemptCount, 2)
    assert.equal(completed.result, 'recovered')
  } finally {
    await queue.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('poison job enters dead-letter and operator retry resets the attempt state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-dead-letter-'))
  const repository = new JsonDurableJobRepository(root)
  const queue = new DurableJobQueue({
    repository,
    workerId: 'worker-dead-letter',
    pollMilliseconds: 10,
    leaseMilliseconds: 1000,
  })
  queue.registerHandler('poison', async () => {
    const error = new Error('fixture poison')
    error.retryable = false
    throw error
  })

  try {
    await queue.start()
    const created = await queue.enqueue({
      jobType: 'poison',
      inputFingerprint: 'sha256:poison',
      payload: {},
    })
    await queue.onIdle()
    const deadLetter = await repository.get(created.jobId)
    assert.equal(deadLetter.status, 'dead_letter')
    assert.equal(deadLetter.errorSummary, 'Durable job gagal.')

    queue.registerHandler('poison', async () => 'retried')
    const retried = await queue.retry(created.jobId)
    assert.equal(retried.status, 'queued')
    assert.equal(retried.attemptCount, 0)
    await queue.onIdle()

    const completed = await repository.get(created.jobId)
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.attemptCount, 1)
    assert.equal(completed.result, 'retried')
  } finally {
    await queue.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('queued job can be cancelled before a worker claims it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-cancel-'))
  const repository = new JsonDurableJobRepository(root)
  try {
    const created = await repository.create({
      jobType: 'cancelled',
      inputFingerprint: 'sha256:cancel',
      payload: {},
    })
    const cancelled = await repository.requestCancel(created.jobId)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.completedAt !== null, true)
    assert.equal(await repository.hasActiveJobs(), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
