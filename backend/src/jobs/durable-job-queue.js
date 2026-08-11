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
    metrics = null,
    metricsRefreshMilliseconds = 5000,
  } = {}) {
    if (!isDurableJobRepository(repository)) {
      throw new TypeError('DurableJobQueue membutuhkan repository durable yang lengkap.')
    }
    this.repository = repository
    this.concurrency = Math.max(1, Number(concurrency) || 1)
    this.workerId = String(workerId)
    this.leaseMilliseconds = Math.max(1000, Number(leaseMilliseconds) || 1000)
    this.pollMilliseconds = Math.max(10, Number(pollMilliseconds) || 10)
    this.metrics = metrics
    this.metricsRefreshMilliseconds = Math.max(
      1000,
      Number(metricsRefreshMilliseconds) || 5000,
    )
    this.clock = clock
    this.handlers = new Map()
    this.running = 0
    this.started = false
    this.pumpPromise = null
    this.metricsTimer = null
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
    await this.#refreshMetrics()
    if (this.metrics) {
      this.metricsTimer = setInterval(() => {
        void this.#refreshMetrics()
      }, this.metricsRefreshMilliseconds)
      this.metricsTimer.unref?.()
    }
    this.#drain()
  }

  async stop() {
    this.started = false
    if (this.metricsTimer) clearInterval(this.metricsTimer)
    this.metricsTimer = null
    if (this.pumpPromise) await this.pumpPromise
    await this.#refreshMetrics()
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
    this.#recordMetric('recordJobEnqueued', {
      jobType,
      deduplicated: job.deduplicated === true,
    })
    void this.#refreshMetrics()
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
    this.#recordMetric('recordJobTransition', job)
    void this.#refreshMetrics()
    this.#drain()
    return job
  }

  async cancel(jobId) {
    const job = await this.repository.requestCancel(jobId)
    this.#recordMetric('recordJobTransition', job)
    void this.#refreshMetrics()
    return job
  }

  async onIdle() {
    while (true) {
      if (this.running === 0 && !(await this.repository.hasActiveJobs())) {
        await this.#refreshMetrics()
        return
      }
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
      try {
        while (this.running < this.concurrency) {
          const job = await this.repository.claimNext({
            workerId: this.workerId,
            leaseMilliseconds: this.leaseMilliseconds,
          })
          if (!job) break
          this.running += 1
          this.#recordMetric('recordJobTransition', job)
          this.#execute(job).finally(() => {
            this.running -= 1
          })
        }

        // A long-running import can hold a database transaction while the
        // worker is still healthy. Repeated lease-recovery queries during that
        // transaction only consume pool connections and can make the worker
        // fail with a connection-timeout error. Recovery is safe to defer
        // until this worker has no active jobs; startup recovery still handles
        // leases left by a crashed process.
        if (this.running === 0) {
          const recovered = await this.repository.recoverExpiredLeases({
            retryAvailableAt: this.clock().toISOString(),
          })
          for (const job of recovered) this.#recordMetric('recordJobTransition', job)
        }
      } catch (error) {
        // Database/network interruptions must not terminate the queue loop.
        // The next iteration retries claim/recovery after a short backoff;
        // active handlers continue independently and persist their own result.
        this.#recordMetric('recordJobQueueError', error)
        await waitFor(Math.max(this.pollMilliseconds, 1000))
      }

      await waitFor(this.pollMilliseconds)
    }
  }

  async #execute(job) {
    const handler = this.handlers.get(job.jobType)
    if (!handler) {
      const failed = await this.repository.fail(job.jobId, this.workerId, {
        errorCode: 'durable_job_handler_missing',
        errorSummary: `Handler untuk job type ${job.jobType} tidak tersedia.`,
        retryable: false,
      })
      this.#recordMetric('recordJobTransition', failed)
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
      const completed = await this.repository.complete(job.jobId, this.workerId, result)
      this.#recordMetric('recordJobTransition', completed)
    } catch (error) {
      const appError = asAppError(error)
      const failed = await this.repository.fail(job.jobId, this.workerId, {
        errorCode: appError.code ?? 'durable_job_failed',
        errorSummary: appError.expose ? appError.message : 'Durable job gagal.',
        retryable: isRetryable(error),
      }).catch(() => {})
      if (failed) this.#recordMetric('recordJobTransition', failed)
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

  #recordMetric(method, value) {
    if (typeof this.metrics?.[method] !== 'function') return
    try {
      this.metrics[method](value)
    } catch {
      // Observability must never change durable job correctness.
    }
  }

  async #refreshMetrics() {
    if (!this.metrics) return
    try {
      if (typeof this.metrics.setGauge === 'function') {
        this.metrics.setGauge(
          'topology_job_worker_active',
          {},
          this.running,
          'Number of durable jobs actively handled by this worker runtime.',
        )
      }
      if (typeof this.repository.list !== 'function'
        || typeof this.metrics.replaceGaugeFamily !== 'function') return
      // Queue-depth metrics need only type/status. Avoid repeatedly loading
      // completed parse results, which can contain multi-megabyte dataset
      // aggregates, every metrics tick.
      const jobs = await this.repository.list({ summary: true })
      const activeStatuses = ['queued', 'running', 'retry_wait']
      const jobTypes = new Set(jobs.map((job) => String(job.jobType)))
      const counts = new Map()
      for (const job of jobs) {
        if (!activeStatuses.includes(job.status)) continue
        const key = `${job.jobType}\u001f${job.status}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const samples = []
      for (const jobType of [...jobTypes].sort()) {
        for (const status of activeStatuses) {
          samples.push({
            labels: { job_type: jobType, status },
            value: counts.get(`${jobType}\u001f${status}`) ?? 0,
          })
        }
      }
      this.metrics.replaceGaugeFamily(
        'topology_job_queue_depth',
        samples,
        'Durable job queue depth by type and status in this runtime view.',
      )
    } catch {
      // A metrics scrape failure must not stop the worker.
    }
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
