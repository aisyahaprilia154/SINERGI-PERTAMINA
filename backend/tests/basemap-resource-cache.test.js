import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm, readdir, writeFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createBasemapResourceCache } from '../src/http/basemap-resource-cache.js'

test('resource cache retries failures, expires entries, bounds disk storage and repairs corruption', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-basemap-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let timestamp = 0
  let loads = 0
  const options = {
    directory, now: () => timestamp, maxMemoryBytes: 0, maxDiskBytes: 2000, maxEntries: 2,
  }
  const cache = createBasemapResourceCache(options)
  const load = async () => { loads += 1; return randomBytes(128) }

  await assert.rejects(cache.get('failed', {
    ttlMs: 1000, maxBytes: 1024, load: async () => { throw new Error('offline') },
  }), /offline/)
  await cache.get('failed', { ttlMs: 1000, maxBytes: 1024, load })
  for (const key of ['tile-a', 'tile-b', 'tile-c']) {
    await cache.get(key, { ttlMs: 1000, maxBytes: 1024, load })
  }
  const files = await readdir(directory)
  assert.ok(files.length <= 2)
  const sizes = await Promise.all(files.map(file => stat(path.join(directory, file))))
  assert.ok(sizes.reduce((sum, file) => sum + file.size, 0) <= 2000)

  const before = loads
  const restarted = createBasemapResourceCache(options)
  await restarted.get('tile-c', { ttlMs: 1000, maxBytes: 1024, load })
  assert.equal(loads, before)
  const filename = createHash('sha256').update('tile-c').digest('hex') + '.cache'
  await writeFile(path.join(directory, filename), 'damaged cache file')
  await restarted.get('tile-c', { ttlMs: 1000, maxBytes: 1024, load })
  assert.equal(loads, before + 1)
  timestamp = 1001
  await restarted.get('tile-c', { ttlMs: 1000, maxBytes: 1024, load })
  assert.equal(loads, before + 2)
})

test('memory pressure never evicts a shared download that is still in flight', async () => {
  const cache = createBasemapResourceCache({ maxMemoryBytes: 1 })
  let finishDownload
  const download = new Promise(resolve => { finishDownload = resolve })
  let loads = 0
  const options = {
    ttlMs: 1000, maxBytes: 1024,
    load: async () => { loads += 1; await download; return Buffer.from('slow tile') },
  }
  const first = cache.get('slow', options)
  await cache.get('fast', {
    ttlMs: 1000, maxBytes: 1024, load: async () => Buffer.from('fast tile'),
  })
  const second = cache.get('slow', options)
  finishDownload()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(loads, 1)
  assert.deepEqual(firstResult.plain, secondResult.plain)
})
