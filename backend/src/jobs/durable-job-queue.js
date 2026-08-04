import os from 'node:os'
import { asAppError } from '../errors.js'
import {
  publicDurableJob,
} from './durable-job-repository.js'

export class DurableJobQueue {
  constructor({
    repository,
    concurrency = 1,
    workerId = `${os.hostname()}-${process.pid}`,
    leaseMilliseconds = 5 * 60 * 1000,
    pollMilliseconds = 100,
    clock = () => new Date(),
  } = {}) {
    if (!isDurableJobRepository(repository)) {
      throw new TypeError('DurableJobQueue membutuhkan repository durable yang lengkap.')
    }
    this.repository = repository
    this.concurrency = Math.max(1, Number(concurrency) || 1)
    this.workerId = String(workerId)
    this.leaseMilliseconds = Math.max(1000, Number(leaseMilliseconds) || 1000)
    this.pollMilliseconds = Math.max(10, Number(pollMilliseconds) || 10)
    this.clock = clock
    this.handlers = new Map()
    this.running = 0
    this.started = false
    this.pumpPromise = null
  }

  registerHandler(jobType, handler) {
    if (!jobType || typeof handler !== 'function') {
      throw new TypeError('Durable job handler tidak valid.')
    }
    this.handlers.set(String(jobType), handler)
  }

  async start() {
    if (this.started) return
    await this.repository.initialize()
    await this.repository.recoverExpiredLeases({
      retryAvailableAt: this.clock().toISOString(),
    })
    this.started = true
    this.#drain()
  }

  async stop() {
    this.started = false
    if (this.pumpPromise) await this.pumpPromise
  }

  async enqueue({
    jobType,
    datasetVersionId = null,
    inputFingerprint,
    ruleSetVersion = null,
    idempotencyKey,
    payload = {},
    maxAttempts = 3,
    availableAt,
    handler,
  }) {
    if (typeof handler === 'function' && !this.handlers.has(jobType)) {
      // This is an intentional same-process fallback. The persisted descriptor
      // remains serializable and a registered handler is required after restart.
      this.registerHandler(jobType, handler)
    }
    const job = await this.repository.create({
      jobType,
      datasetVersionId,
      inputFingerprint,
      ruleSetVersion,
      idempotencyKey,
      payload,
      maxAttempts,
      availableAt,
    })
    this.#drain()
    return job
  }

  async get(jobId) {
    return this.repository.get(jobId)
  }

  async getPublic(jobId) {
    return publicDurableJob(await this.get(jobId))
  }

  async retry(jobId) {
    const job = await this.repository.retry(jobId)
    this.#drain()
    return job
  }

  async cancel(jobId) {
    return this.repository.requestCancel(jobId)
  }

  async onIdle() {
    while (true) {
      if (this.running === 0 && !(await this.repository.hasActiveJobs())) return
      await waitFor(this.pollMilliseconds)
    }
  }

  #drain() {
    if (!this.started || this.pumpPromise) return
    this.pumpPromise = this.#pump().finally(() => {
      this.pumpPromise = null
    })
  }

  async #pump() {
    while (this.started) {
      while (this.running < this.concurrency) {
        const job = await this.repository.claimNext({
          workerId: this.workerId,
          leaseMilliseconds: this.leaseMilliseconds,
        })
        if (!job) break
        this.running += 1
        this.#execute(job).finally(() => {
          this.running -= 1
        })
      }

      await waitFor(this.pollMilliseconds)
      await this.repository.recoverExpiredLeases({
        retryAvailableAt: this.clock().toISOString(),
      })
    }
  }

  async #execute(job) {
    const handler = this.handlers.get(job.jobType)
    if (!handler) {
      await this.repository.fail(job.jobId, this.workerId, {
        errorCode: 'durable_job_handler_missing',
        errorSummary: `Handler untuk job type ${job.jobType} tidak tersedia.`,
        retryable: false,
      })
      return
    }

    const renewTimer = setInterval(() => {
      this.repository.renew(job.jobId, this.workerId, this.leaseMilliseconds)
        .catch(() => {})
    }, Math.max(1000, Math.floor(this.leaseMilliseconds / 3)))
    renewTimer.unref?.()

    try {
      const result = await handler(job.payload, {
        job: structuredClone(job),
        updateProgress: (progress, stage) => this.#updateProgress(job, progress, stage),
        isCancellationRequested: () => this.repository.isCancelRequested(job.jobId),
      })
      await this.repository.complete(job.jobId, this.workerId, result)
    } catch (error) {
      const appError = asAppError(error)
      await this.repository.fail(job.jobId, this.workerId, {
        errorCode: appError.code ?? 'durable_job_failed',
        errorSummary: appError.expose ? appError.message : 'Durable job gagal.',
        retryable: isRetryable(error),
      }).catch(() => {})
    } finally {
      clearInterval(renewTimer)
    }
  }

  async #updateProgress(job, progress, stage) {
    const normalizedProgress = Math.max(0, Math.min(100, Number(progress) || 0))
    return this.repository.update(job.jobId, (current) => {
      if (current.status !== 'running' || current.lockedBy !== this.workerId) return current
      return {
        ...current,
        progress: normalizedProgress,
        stage: String(stage ?? current.stage).slice(0, 128),
      }
    })
  }
}

function isDurableJobRepository(repository) {
  return Boolean(repository)
    && [
      'initialize', 'create', 'get', 'update', 'claimNext',
      'recoverExpiredLeases', 'renew', 'complete', 'fail',
      'isCancelRequested', 'requestCancel', 'retry', 'hasActiveJobs',
    ].every((method) => typeof repository[method] === 'function')
}

function isRetryable(error) {
  return error?.retryable !== false && error?.code !== 'invalid_topology_input_bundle'
}

function waitFor(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref?.()
  })
}
