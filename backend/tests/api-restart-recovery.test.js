import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const backendDirectory = path.resolve(testDirectory, '..')
const serverEntry = path.join(backendDirectory, 'src', 'server.js')
const RESTART_RECOVERY_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder id="network">
      <name>Jaringan CCTV</name>
      <Placemark id="camera-1">
        <name>Camera Gate</name>
        <ExtendedData>
          <Data name="ASSET_ID"><value>CCTV-RESTART-01</value></Data>
          <Data name="type"><value>CCTV</value></Data>
        </ExtendedData>
        <Point><coordinates>110.4,-6.9,12</coordinates></Point>
      </Placemark>
    </Folder>
  </Document>
</kml>`

test('API restart keeps an accepted import job and dataset status durable', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'sinergi-api-restart-recovery-'))
  const port = await getFreePort()
  let firstServer = null
  let secondServer = null
  try {
    firstServer = await startServer({ dataRoot, port })
    const form = new FormData()
    form.append('branchId', 'semarang')
    form.append(
      'file',
      new Blob([RESTART_RECOVERY_KML], { type: 'application/vnd.google-earth.kml+xml' }),
      'restart-recovery.kml',
    )
    const acceptedResponse = await fetch(`${firstServer.origin}/api/admin/imports`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
      body: form,
    })
    const accepted = await acceptedResponse.json()
    assert.equal(acceptedResponse.status, 202)
    assert.equal(accepted.datasetVersion.status, 'processing')
    assert.ok(accepted.processing.jobId)
    assert.match(accepted.statusUrl, /^\/api\/admin\/imports\/dv-/)

    const jobPath = path.join(dataRoot, 'jobs', `${accepted.processing.jobId}.json`)
    await waitUntil(async () => await fileExists(jobPath))
    const beforeRestartJob = JSON.parse(await readFile(jobPath, 'utf8'))
    assert.equal(beforeRestartJob.jobId, accepted.processing.jobId)
    assert.equal(beforeRestartJob.datasetVersionId, accepted.datasetVersion.id)

    await stopServer(firstServer)
    firstServer = null
    await delay(1300)

    secondServer = await startServer({ dataRoot, port })
    const terminalJob = await waitForTerminalJob(
      secondServer.origin,
      accepted.processing.jobId,
    )
    assert.equal(terminalJob.jobId, beforeRestartJob.jobId)
    assert.equal(terminalJob.datasetVersionId, beforeRestartJob.datasetVersionId)
    assert.ok(['succeeded', 'failed', 'dead_letter'].includes(terminalJob.status))

    const statusResponse = await fetch(
      `${secondServer.origin}${accepted.statusUrl}`,
      { headers: { authorization: 'Bearer admin-token' } },
    )
    const status = await statusResponse.json()
    assert.equal(statusResponse.status, 200)
    assert.equal(status.datasetVersion.id, accepted.datasetVersion.id)
    assert.equal(status.processing.jobId, accepted.processing.jobId)

    const afterRestartJob = JSON.parse(await readFile(jobPath, 'utf8'))
    assert.equal(afterRestartJob.jobId, beforeRestartJob.jobId)
    assert.equal(afterRestartJob.idempotencyKey, beforeRestartJob.idempotencyKey)
    assert.ok(afterRestartJob.revision >= beforeRestartJob.revision)
  } finally {
    if (secondServer) await stopServer(secondServer)
    if (firstServer) await stopServer(firstServer)
    await rm(dataRoot, { recursive: true, force: true })
  }
})

async function startServer({ dataRoot, port }) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      SINERGI_STORAGE_MODE: 'json',
      SINERGI_DATA_ROOT: dataRoot,
      SINERGI_HOST: '127.0.0.1',
      SINERGI_PORT: String(port),
      SINERGI_BRANCH_IDS: 'semarang',
      SINERGI_BRANCH_DATASETS: JSON.stringify({ semarang: 'dataset-semarang' }),
      SINERGI_AUTH_TOKENS: JSON.stringify({
        'admin-token': { id: 'admin-1', role: 'Administrator' },
      }),
      SINERGI_JOB_LEASE_MS: '1000',
      SINERGI_JOB_LOCK_STALE_MS: '1000',
      SINERGI_JOB_POLL_MS: '20',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const output = []
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const onOutput = (stream, label) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString()
      output.push(`${label}: ${text}`)
      if (text.includes('SINERGI import service listening')) readyResolve()
    })
  }
  onOutput(child.stdout, 'stdout')
  onOutput(child.stderr, 'stderr')
  child.once('error', readyReject)
  child.once('exit', (code, signal) => {
    readyReject(new Error(
      `Server berhenti sebelum ready (code=${code}, signal=${signal}). ${output.join('')}`,
    ))
  })
  await withTimeout(ready, 15000, 'server startup')
  return { child, origin: `http://127.0.0.1:${port}` }
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return
  const exited = new Promise((resolve) => server.child.once('exit', resolve))
  server.child.kill('SIGTERM')
  await withTimeout(exited, 10000, 'server shutdown')
}

async function waitForTerminalJob(origin, jobId) {
  let lastJob = null
  try {
    await waitUntil(async () => {
      const response = await fetch(`${origin}/api/admin/jobs/${jobId}`, {
        headers: { authorization: 'Bearer admin-token' },
      })
      if (response.status !== 200) return false
      const body = await response.json()
      lastJob = body.job
      return ['succeeded', 'failed', 'dead_letter'].includes(body.job.status)
    }, { timeoutMs: 20000, intervalMs: 50 })
  } catch (error) {
    error.message = `${error.message} lastJob=${JSON.stringify(lastJob)}`
    throw error
  }
  return lastJob
}

async function getFreePort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const port = probe.address().port
  await new Promise((resolve, reject) => {
    probe.close((error) => error ? reject(error) : resolve())
  })
  return port
}

async function waitUntil(predicate, {
  timeoutMs = 10000,
  intervalMs = 25,
} = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Kondisi tidak tercapai sebelum timeout.')
}

async function fileExists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withTimeout(promise, timeoutMs, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout.`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
