import assert from 'node:assert/strict'
import test from 'node:test'
import { preloadBasemapResources } from '../src/pages/map/basemap-preload.js'

test('first map metadata and label font preload together without blocking on provider failure', async () => {
  const requests = []
  const pending = []
  const result = preloadBasemapResources('/api/basemap/openfreemap/planet', url => {
    requests.push(url)
    return new Promise(resolve => pending.push(resolve))
  })
  assert.deepEqual(requests, [
    '/api/basemap/openfreemap/planet',
    '/api/basemap/openfreemap/fonts/Noto%20Sans%20Regular/0-255.pbf',
  ])
  pending.forEach(resolve => resolve(new Response(new Uint8Array([1, 2, 3]))))
  assert.ok((await result).every(entry => entry.status === 'fulfilled'))
  const failed = await preloadBasemapResources('/api/basemap/openfreemap/planet', async () => {
    throw new Error('offline')
  })
  assert.ok(failed.every(entry => entry.status === 'rejected'))
})

test('a configured vector provider only preloads its own metadata', async () => {
  const requests = []
  await preloadBasemapResources('https://provider.example/tiles.json', async url => {
    requests.push(url)
    return new Response(new Uint8Array([1]))
  })
  assert.deepEqual(requests, ['https://provider.example/tiles.json'])
})
