import { randomUUID } from 'node:crypto'

export class BackgroundJobQueue {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = Math.max(1, concurrency)
    this.pending = []
    this.running = 0
    this.idleResolvers = []
  }

  enqueue(job) {
    const descriptor = typeof job === 'object' && job?.handler
      ? {
        ...job,
        jobId: job.jobId ?? `job-${randomUUID()}`,
      }
      : job
    const task = typeof job === 'function'
      ? job
      : typeof descriptor?.handler === 'function'
        ? () => descriptor.handler(descriptor.payload ?? {}, {
          job: descriptorWithoutHandler(descriptor),
          updateProgress: async () => {},
          isCancellationRequested: async () => false,
        })
        : null
    if (typeof task !== 'function') {
      throw new TypeError('Background job harus berupa function atau descriptor dengan handler.')
    }
    this.pending.push(task)
    this.#drain()
  }

  onIdle() {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }

  #drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const job = this.pending.shift()
      this.running += 1
      Promise.resolve()
        .then(job)
        .catch(() => {
          // Jobs own their error persistence and audit logging.
        })
        .finally(() => {
          this.running -= 1
          this.#resolveIdle()
          this.#drain()
        })
    }
  }

  #resolveIdle() {
    if (this.running !== 0 || this.pending.length !== 0) return
    this.idleResolvers.splice(0).forEach((resolve) => resolve())
  }
}

function descriptorWithoutHandler(job) {
  const { handler, ...descriptor } = job
  return structuredClone(descriptor)
}
