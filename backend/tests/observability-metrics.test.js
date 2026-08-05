import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { MetricsRegistry, normalizeHttpRoute } from '../src/observability/metrics.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { JsonLinesAuditLog } from '../src/storage/audit-log.js'

test('metrics registry records bounded HTTP labels and process evidence', async () => {
  const metrics = new MetricsRegistry({
    clock: () => new Date('2026-08-05T00:00:00.000Z'),
  })

  assert.equal(
    normalizeHttpRoute('/api/topology/candidates/candidate-secret/confirm'),
    '/api/topology/candidates/:id/:action',
  )
  metrics.recordHttpRequest({
    method: 'GET',
    route: normalizeHttpRoute('/api/topology/candidates/candidate-secret/confirm'),
    statusCode: 200,
    durationSeconds: 0.012,
  })
  metrics.recordHttpRequest({
    method: 'POST',
    route: '/unmatched',
    statusCode: 500,
    durationSeconds: 0.2,
  })

  const output = await metrics.renderPrometheus()
  assert.match(output, /topology_api_requests_total\{method="GET",route="\/api\/topology\/candidates\/:id\/:action",status="200"\} 1/)
  assert.match(output, /topology_api_request_duration_seconds_count\{method="GET",route="\/api\/topology\/candidates\/:id\/:action",status="200"\} 1/)
  assert.match(output, /topology_api_request_errors_total\{method="POST",route="\/unmatched",status="500"\} 1/)
  assert.match(output, /process_resident_memory_bytes [0-9.]+/)
  assert.doesNotMatch(output, /candidate-secret/)
})

test('metrics endpoint is disabled by default and protected by Administrator auth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-metrics-'))
  const auditLog = new JsonLinesAuditLog(path.join(root, 'audit.jsonl'))
  const authenticator = new TokenAuthenticator({
    'admin-token': { id: 'admin-1', role: 'Administrator' },
  })
  const createFixture = (metricsEnabled) => createApp({
    config: { observability: { metricsEnabled } },
    authenticator,
    repository: {},
    fileStore: {},
    auditLog,
    jobQueue: null,
    importPipeline: {},
    lifecycleService: {},
    topologyService: {},
  })
  const disabledApp = createFixture(false)
  const enabledApp = createFixture(true)
  let disabledListening = false
  let enabledListening = false

  try {
    await new Promise((resolve) => disabledApp.listen(0, '127.0.0.1', resolve))
    disabledListening = true
    const disabledAddress = disabledApp.address()
    const disabledResponse = await fetch(`http://127.0.0.1:${disabledAddress.port}/metrics`, {
      headers: { authorization: 'Bearer admin-token' },
    })
    assert.equal(disabledResponse.status, 404)

    await new Promise((resolve) => enabledApp.listen(0, '127.0.0.1', resolve))
    enabledListening = true
    const enabledAddress = enabledApp.address()
    const origin = `http://127.0.0.1:${enabledAddress.port}`
    const unauthenticated = await fetch(`${origin}/metrics`)
    assert.equal(unauthenticated.status, 401)

    const health = await fetch(`${origin}/health`)
    assert.equal(health.status, 200)

    const metricsResponse = await fetch(`${origin}/metrics`, {
      headers: { authorization: 'Bearer admin-token' },
    })
    assert.equal(metricsResponse.status, 200)
    assert.match(metricsResponse.headers.get('content-type') ?? '', /text\/plain/)
    const body = await metricsResponse.text()
    assert.match(body, /topology_api_requests_total/)
    assert.match(body, /route="\/health"/)
    assert.doesNotMatch(body, /admin-token/)
  } finally {
    await closeServer(disabledApp, disabledListening)
    await closeServer(enabledApp, enabledListening)
    await rm(root, { recursive: true, force: true })
  }
})

async function closeServer(server, listening) {
  if (!listening) return
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
