import { DurableJobQueue } from '../../src/jobs/durable-job-queue.js'
import { JsonDurableJobRepository } from '../../src/jobs/durable-job-repository.js'

const [rootDirectory, mode] = process.argv.slice(2)

if (!rootDirectory || mode !== 'crash-after-claim') {
  throw new Error('Worker fixture membutuhkan root directory dan mode crash-after-claim.')
}

const repository = new JsonDurableJobRepository(rootDirectory, {
  staleLockMilliseconds: 5000,
})
const queue = new DurableJobQueue({
  repository,
  workerId: `crashed-worker-${process.pid}`,
  leaseMilliseconds: 1000,
  pollMilliseconds: 10,
})

queue.registerHandler('restartable', async () => {
  send({ type: 'claimed' })
  await waitForCommand('crash')
  process.exit(17)
})

try {
  await queue.start()
  send({ type: 'ready' })
  await waitForCommand('begin')
  await queue.onIdle()
  await queue.stop()
} catch (error) {
  send({
    type: 'error',
    code: error?.code ?? 'worker_fixture_failed',
    message: error?.message ?? String(error),
  })
  process.exitCode = 1
}

function send(message) {
  if (typeof process.send === 'function') process.send(message)
}

function waitForCommand(expected) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type !== expected) return
      process.off('message', onMessage)
      resolve()
    }
    process.on('message', onMessage)
    process.once('disconnect', () => {
      process.off('message', onMessage)
      reject(new Error(`Parent worker fixture terputus sebelum command ${expected}.`))
    })
  })
}
