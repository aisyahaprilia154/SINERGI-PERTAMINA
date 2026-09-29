import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createRevisionResponseCache } from '../src/http/revision-response-cache.js'
import { JsonDatasetVersionRepository } from '../src/storage/dataset-version-repository.js'
import { PostgresDatasetVersionRepository } from '../src/storage/postgres-dataset-version-repository.js'
import { createApp } from '../src/app.js'

test('revision cache coalesces reads, compresses, revalidates, and isolates scopes', async t => {
  let loads = 0
  let revision = '1'
  const send = createRevisionResponseCache()
  const server = http.createServer((req, res) => {
    send(req, res, { key: req.url, revision, load: async () => {
      loads++
      await new Promise(resolve => setTimeout(resolve, 10))
      return { revision, value: 'dataset '.repeat(1000) }
    } }).catch(() => { res.writeHead(500); res.end() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}`
  const responses = await Promise.all([fetch(`${url}/map`), fetch(`${url}/map`)])
  assert.equal(loads, 1)
  assert.equal(responses[0].headers.get('content-encoding'), 'gzip')
  assert.match(responses[0].headers.get('cache-control'), /private.*no-cache/)
  assert.match(responses[0].headers.get('vary'), /Authorization/)
  const etag = responses[0].headers.get('etag')
  assert.equal((await responses[0].json()).revision, '1')
  await responses[1].arrayBuffer()
  const unchanged = await fetch(`${url}/map`, { headers: { 'If-None-Match': etag } })
  assert.equal(unchanged.status, 304)
  assert.equal(await unchanged.text(), '')
  assert.equal(loads, 1)
  revision = '2'
  const changed = await fetch(`${url}/map`, { headers: { 'If-None-Match': etag } })
  assert.equal(changed.status, 200)
  assert.equal((await changed.json()).revision, '2')
  assert.equal(loads, 2)
  await (await fetch(`${url}/topology`)).arrayBuffer()
  assert.equal(loads, 3)
  const identity = await fetch(`${url}/map`, { headers: { 'Accept-Encoding': 'gzip;q=0' } })
  assert.equal(identity.headers.get('content-encoding'), null)
  assert.equal((await identity.json()).revision, '2')
})

test('failed reads are retryable and cache memory is bounded', async () => {
  const send = createRevisionResponseCache({ maxBytes: 1 })
  const request = { headers: {} }
  const response = { writeHead() {}, end() {} }
  await assert.rejects(send(request, response, {
    key: 'view', revision: '1', load: () => { throw new Error('offline') },
  }), /offline/)
  let loads = 0
  const options = { key: 'view', revision: '1', load: () => ({ count: ++loads }) }
  await send(request, response, options)
  await send(request, response, options)
  assert.equal(loads, 2)
})

test('JSON view revisions change on writes, external replacements, and activation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sinergi-cache-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new JsonDatasetVersionRepository(directory)
  const record = { datasetVersion: { id: 'v1', datasetId: 'd1', branchId: 'b1' }, value: 'old' }
  await repository.create(record)
  assert.equal(await repository.getActiveReadRevision({ datasetId: 'd1' }), null)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path.join(directory, '.active'))
  const pointerPath = path.join(directory, '.active', `${createHash('sha256').update('d1').digest('hex')}.json`)
  const pointer = { datasetVersionId: 'v1', datasetId: 'd1', branchId: 'b1', revision: 1 }
  await writeFile(pointerPath, JSON.stringify(pointer))
  const first = await repository.getActiveReadRevision({ datasetId: 'd1' })
  assert.equal(await repository.getActiveReadRevision({ datasetId: 'd1' }), first)
  await repository.update('v1', current => { current.value = 'new'; return current }, { expectedRevision: 0 })
  const second = await repository.getActiveReadRevision({ datasetId: 'd1' })
  assert.notEqual(second, first)
  await assert.rejects(repository.update('v1', { value: 'stale' }, { expectedRevision: 0 }),
    { code: 'dataset_version_stale_revision' })
  await assert.rejects(repository.update('v1', current => { current.value = 'failed'; throw new Error('failed') }), /failed/)
  assert.equal((await repository.get('v1')).value, 'new')
  const owned = await repository.update('v1', current => current, { projectionMode: 'topology-review' })
  owned.value = 'client mutation'
  assert.equal((await repository.get('v1')).value, 'new')
  await writeFile(path.join(directory, 'replacement.tmp'), JSON.stringify(record))
  await rename(path.join(directory, 'replacement.tmp'), path.join(directory, 'v1.json'))
  assert.notEqual(await repository.getActiveReadRevision({ datasetId: 'd1' }), second)
  await repository.create({ datasetVersion: { ...record.datasetVersion, id: 'v2' } })
  await writeFile(pointerPath, JSON.stringify({ ...pointer, datasetVersionId: 'v2', revision: 2 }))
  assert.notEqual(await repository.getActiveReadRevision({ datasetId: 'd1' }), first)
})

test('active HTTP cache checks branch authorization even for a matching ETag', async t => {
  let loads = 0
  let revision = '1'
  const app = createApp({
    config: { allowedBranchIds: ['semarang', 'other'] },
    authenticator: { authenticate: request => ({
      role: 'viewer', datasetIds: [],
      branchIds: request.headers.authorization === 'Bearer allowed' ? ['semarang'] : ['other'],
    }) },
    repository: { getActiveReadRevision: async () => revision },
    lifecycleService: { getActiveMapDataset: async () => ({ revision, loads: ++loads }) },
  })
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  t.after(() => { app.closeAllConnections(); app.close() })
  const url = `http://127.0.0.1:${app.address().port}/api/datasets/d1/active?branchId=semarang&view=map`
  const headers = { Authorization: 'Bearer allowed' }
  const initial = await fetch(url, { headers })
  assert.equal(initial.status, 200)
  const etag = initial.headers.get('etag')
  await initial.arrayBuffer()
  const forbidden = await fetch(url, { headers: { Authorization: 'Bearer denied', 'If-None-Match': etag } })
  assert.equal(forbidden.status, 403)
  await forbidden.arrayBuffer()
  const cached = await fetch(url, { headers: { ...headers, 'If-None-Match': etag } })
  assert.equal(cached.status, 304)
  assert.equal(loads, 1)
  revision = '2'
  const updated = await fetch(url, { headers: { ...headers, 'If-None-Match': etag } })
  assert.equal((await updated.json()).revision, '2')
  assert.equal(loads, 2)
})

test('PostgreSQL cache revision uses pointer and row version without loading aggregate', async () => {
  const calls = []
  let rows = [{ dataset_version_id: 'v1', revision: 1, storage_revision: '10' }]
  const repository = new PostgresDatasetVersionRepository({
    connect() {}, query: async (sql, parameters) => { calls.push({ sql, parameters }); return { rows } },
  })
  const context = { datasetId: 'd1', branchId: 'b1' }
  const first = await repository.getActiveReadRevision(context)
  rows = [{ ...rows[0], storage_revision: '11' }]
  assert.notEqual(await repository.getActiveReadRevision(context), first)
  assert.deepEqual(calls[0].parameters, ['d1', 'b1'])
  assert.match(calls[0].sql, /xmin::text/)
  assert.doesNotMatch(calls[0].sql, /payload/)
  rows = []
  assert.equal(await repository.getActiveReadRevision(context), null)
})
