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

test('queue survives transient database errors while polling for recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-poll-error-'))
  const repository = new JsonDurableJobRepository(root)
  const queue = new DurableJobQueue({
    repository,
    workerId: 'worker-poll-error',
    pollMilliseconds: 10,
    leaseMilliseconds: 10000,
  })

  try {
    await queue.start()
    const recoverExpiredLeases = repository.recoverExpiredLeases.bind(repository)
    let failuresRemaining = 2
    repository.recoverExpiredLeases = async (...args) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1
        throw new Error('transient database timeout')
      }
      return recoverExpiredLeases(...args)
    }
    queue.registerHandler('poll_error_recovery', async () => ({ ok: true }))
    const created = await queue.enqueue({
      jobType: 'poll_error_recovery',
      datasetVersionId: 'dv-poll-error',
      inputFingerprint: 'sha256:poll-error',
      payload: {},
    })

    await queue.onIdle()

    const completed = await repository.get(created.jobId)
    assert.equal(completed.status, 'succeeded')
    assert.deepEqual(completed.result, { ok: true })
  } finally {
    await queue.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('two repository workers cannot claim the same durable job', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-double-claim-'))
  const firstRepository = new JsonDurableJobRepository(root)
  const secondRepository = new JsonDurableJobRepository(root)

  try {
    const created = await firstRepository.create({
      jobType: 'double_claim_guard',
      datasetVersionId: 'dv-double-claim',
      inputFingerprint: 'sha256:double-claim',
      payload: { fixture: true },
    })
    const claims = await Promise.all([
      firstRepository.claimNext({ workerId: 'worker-a', leaseMilliseconds: 60_000 }),
      secondRepository.claimNext({ workerId: 'worker-b', leaseMilliseconds: 60_000 }),
    ])
    const successfulClaims = claims.filter(Boolean)

    assert.equal(successfulClaims.length, 1)
    assert.equal(successfulClaims[0].jobId, created.jobId)
    assert.ok(['worker-a', 'worker-b'].includes(successfulClaims[0].lockedBy))
    const persisted = await firstRepository.get(created.jobId)
    assert.equal(persisted.status, 'running')
    assert.equal(persisted.attemptCount, 1)
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    })
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

test('retryable job uses exponential backoff and dead-letters after maximum attempts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-backoff-'))
  let nowMilliseconds = Date.parse('2026-08-05T00:00:00.000Z')
  const repository = new JsonDurableJobRepository(root, {
    clock: () => new Date(nowMilliseconds),
  })

  try {
    const created = await repository.create({
      jobType: 'flaky',
      datasetVersionId: 'dv-backoff-test',
      inputFingerprint: 'sha256:backoff',
      payload: {},
      maxAttempts: 3,
    })

    const firstClaim = await repository.claimNext({
      workerId: 'worker-flaky',
      leaseMilliseconds: 60000,
    })
    assert.equal(firstClaim.attemptCount, 1)
    const firstFailure = await repository.fail(created.jobId, 'worker-flaky', {
      errorCode: 'temporary_failure',
      retryable: true,
    })
    assert.equal(firstFailure.status, 'retry_wait')
    assert.equal(
      Date.parse(firstFailure.availableAt) - nowMilliseconds,
      1000,
    )
    assert.equal(await repository.claimNext({ workerId: 'worker-flaky' }), null)

    nowMilliseconds += 1000
    const secondClaim = await repository.claimNext({
      workerId: 'worker-flaky',
      leaseMilliseconds: 60000,
    })
    assert.equal(secondClaim.attemptCount, 2)
    const secondFailure = await repository.fail(created.jobId, 'worker-flaky', {
      errorCode: 'temporary_failure',
      retryable: true,
    })
    assert.equal(secondFailure.status, 'retry_wait')
    assert.equal(
      Date.parse(secondFailure.availableAt) - nowMilliseconds,
      2000,
    )
    nowMilliseconds += 1999
    assert.equal(await repository.claimNext({ workerId: 'worker-flaky' }), null)

    nowMilliseconds += 1
    const thirdClaim = await repository.claimNext({
      workerId: 'worker-flaky',
      leaseMilliseconds: 60000,
    })
    assert.equal(thirdClaim.attemptCount, 3)
    const deadLetter = await repository.fail(created.jobId, 'worker-flaky', {
      errorCode: 'temporary_failure',
      retryable: true,
    })
    assert.equal(deadLetter.status, 'dead_letter')
    assert.equal(deadLetter.attemptCount, 3)
    assert.equal(deadLetter.errorCode, 'temporary_failure')
    assert.equal(deadLetter.completedAt, new Date(nowMilliseconds).toISOString())
  } finally {
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
