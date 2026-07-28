export class BackgroundJobQueue {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = Math.max(1, concurrency)
    this.pending = []
    this.running = 0
    this.idleResolvers = []
  }

  enqueue(job) {
    this.pending.push(job)
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
