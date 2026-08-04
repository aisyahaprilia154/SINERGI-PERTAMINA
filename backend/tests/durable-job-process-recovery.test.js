import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DurableJobQueue } from '../src/jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from '../src/jobs/durable-job-repository.js'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const workerFixture = path.join(testDirectory, 'fixtures', 'durable-job-process-worker.mjs')

test('worker restart recovers an expired lease and materializes one artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sinergi-durable-process-recovery-'))
  let crashedWorker = null
  let replacementQueue = null
  try {
    const artifactPath = path.join(root, 'artifacts', 'topology-artifact.json')
    const repository = new JsonDurableJobRepository(root, {
      staleLockMilliseconds: 5000,
    })
    const created = await repository.create({
      jobId: 'job-process-recovery',
      jobType: 'restartable',
      datasetVersionId: 'dv-process-recovery',
      inputFingerprint: 'sha256:process-recovery',
      ruleSetVersion: 'rule/1.0.0',
      payload: {
        artifactPath,
        artifactId: 'artifact:process-recovery',
      },
      maxAttempts: 3,
    })

    crashedWorker = spawn(process.execPath, [workerFixture, root, 'crash-after-claim'], {
      cwd: path.dirname(testDirectory),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    const ready = await waitForMessage(crashedWorker, (message) => message?.type === 'ready')
    assert.equal(ready.type, 'ready')
    crashedWorker.send({ type: 'begin' })
    const claimed = await waitForMessage(
      crashedWorker,
      (message) => message?.type === 'claimed' || message?.type === 'error',
    )
    assert.equal(claimed.type, 'claimed', claimed.message)

    const inFlight = await repository.get(created.jobId)
    assert.equal(inFlight.status, 'running')
    assert.equal(inFlight.attemptCount, 1)
    assert.equal(inFlight.lockedBy.startsWith('crashed-worker-'), true)
    assert.ok(inFlight.lockExpiresAt)

    crashedWorker.send({ type: 'crash' })
    const exit = await waitForExit(crashedWorker)
    assert.equal(exit.code, 17)

    await waitUntil(async () => {
      const current = await repository.get(created.jobId)
      return Date.parse(current.lockExpiresAt) <= Date.now()
    })

    let materializationCount = 0
    const replacementRepository = new JsonDurableJobRepository(root, {
      staleLockMilliseconds: 5000,
    })
    replacementQueue = new DurableJobQueue({
      repository: replacementRepository,
      workerId: 'replacement-worker',
      leaseMilliseconds: 1000,
      pollMilliseconds: 10,
    })
    replacementQueue.registerHandler('restartable', async (payload) => {
      materializationCount += 1
      await mkdir(path.dirname(payload.artifactPath), { recursive: true })
      await writeFile(
        payload.artifactPath,
        JSON.stringify({ artifactId: payload.artifactId }),
        { encoding: 'utf8', flag: 'wx' },
      )
      return { artifactId: payload.artifactId }
    })

    await replacementQueue.start()
    await replacementQueue.onIdle()

    const completed = await replacementRepository.get(created.jobId)
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.attemptCount, 2)
    assert.equal(completed.lockedBy, null)
    assert.deepEqual(completed.result, { artifactId: 'artifact:process-recovery' })
    assert.equal(materializationCount, 1)
    assert.deepEqual(
      JSON.parse(await readFile(artifactPath, 'utf8')),
      { artifactId: 'artifact:process-recovery' },
    )

    const duplicate = await replacementRepository.create({
      jobType: 'restartable',
      datasetVersionId: 'dv-process-recovery',
      inputFingerprint: 'sha256:process-recovery',
      ruleSetVersion: 'rule/1.0.0',
      payload: {
        artifactPath,
        artifactId: 'artifact:process-recovery',
      },
    })
    assert.equal(duplicate.jobId, created.jobId)
    assert.equal(duplicate.deduplicated, true)
    assert.deepEqual(
      (await readdir(root)).filter((entry) => entry.endsWith('.json')),
      ['job-process-recovery.json'],
    )
  } finally {
    await replacementQueue?.stop().catch(() => {})
    if (crashedWorker && crashedWorker.exitCode === null) crashedWorker.kill()
    await rm(root, { recursive: true, force: true })
  }
})

function waitForMessage(child, predicate, timeoutMilliseconds = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Worker fixture tidak mengirim message sesuai batas waktu.'))
    }, timeoutMilliseconds)
    const onMessage = (message) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`Worker fixture berhenti sebelum message: code=${code}, signal=${signal}.`))
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function waitForExit(child, timeoutMilliseconds = 5000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Worker fixture tidak berhenti sesuai batas waktu.'))
    }, timeoutMilliseconds)
    const onExit = (code, signal) => {
      cleanup()
      resolve({ code, signal })
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function waitUntil(predicate, timeoutMilliseconds = 5000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Condition tidak tercapai sesuai batas waktu.')
}
