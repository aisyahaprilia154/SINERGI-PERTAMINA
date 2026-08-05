import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { MetricsRegistry } from '../src/observability/metrics.js'
import { DurableJobQueue } from '../src/jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from '../src/jobs/durable-job-repository.js'

test('durable queue records job transitions, duration, deduplication, and depth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-job-metrics-'))
  const repository = new JsonDurableJobRepository(root)
  const metrics = new MetricsRegistry()
  const queue = new DurableJobQueue({
    repository,
    metrics,
    workerId: 'metrics-worker',
    pollMilliseconds: 10,
    metricsRefreshMilliseconds: 1000,
  })
  queue.registerHandler('metrics_work', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { ok: true }
  })

  try {
    await queue.start()
    const first = await queue.enqueue({
      jobType: 'metrics_work',
      datasetVersionId: 'dv-metrics',
      inputFingerprint: 'sha256:metrics',
      payload: {},
    })
    const duplicate = await queue.enqueue({
      jobType: 'metrics_work',
      datasetVersionId: 'dv-metrics',
      inputFingerprint: 'sha256:metrics',
      payload: {},
    })
    assert.equal(duplicate.jobId, first.jobId)
    await queue.onIdle()

    const output = await metrics.renderPrometheus()
    assert.match(output, /topology_jobs_total\{job_type="metrics_work"\} 1/)
    assert.match(output, /topology_job_deduplicated_total\{job_type="metrics_work"\} 1/)
    assert.match(output, /topology_job_transitions_total\{job_type="metrics_work",status="running"\} 1/)
    assert.match(output, /topology_job_transitions_total\{job_type="metrics_work",status="succeeded"\} 1/)
    assert.match(output, /topology_job_duration_seconds_count\{job_type="metrics_work",status="succeeded"\} 1/)
    assert.match(output, /topology_job_queue_depth\{job_type="metrics_work",status="queued"\} 0/)
    assert.match(output, /topology_job_worker_active 0/)
    assert.doesNotMatch(output, /dv-metrics/)
  } finally {
    await queue.stop()
    await rm(root, { recursive: true, force: true })
  }
})
