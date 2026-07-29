import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../src/app.js'

test('OpenFreeMap proxy rewrites TileJSON and serves tiles and fonts from same origin', async (t) => {
  const calls = []
  const versionedTile = 'https://tiles.openfreemap.org/planet/'
    + '20260621_080001_pt/{z}/{x}/{y}.pbf'
  const basemapFetch = async (url) => {
    calls.push(url)
    if (url === 'https://tiles.openfreemap.org/planet') {
      return new Response(JSON.stringify({
        tilejson: '3.0.0',
        tiles: [versionedTile],
        minzoom: 0,
        maxzoom: 14,
        vector_layers: [],
      }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url === versionedTile
      .replace('{z}', '14')
      .replace('{x}', '13217')
      .replace('{y}', '8511')) {
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { 'content-type': 'application/vnd.mapbox-vector-tile' },
      })
    }
    if (url === 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf') {
      return new Response(Uint8Array.from([4, 5]), {
        headers: { 'content-type': 'application/x-protobuf' },
      })
    }
    return new Response(null, { status: 404 })
  }
  const app = createApp({
    basemapFetch,
    auditLog: { async record() {} },
  })
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => app.close(resolve)))
  const { port } = app.address()
  const origin = `http://127.0.0.1:${port}`

  const metadataResponse = await fetch(`${origin}/api/basemap/openfreemap/planet`)
  assert.equal(metadataResponse.status, 200)
  assert.equal(metadataResponse.headers.get('content-type'), 'application/json; charset=utf-8')
  const metadata = await metadataResponse.json()
  assert.deepEqual(metadata.tiles, [
    '/api/basemap/openfreemap/tiles/{z}/{x}/{y}.pbf',
  ])

  const tileResponse = await fetch(
    `${origin}/api/basemap/openfreemap/tiles/14/13217/8511.pbf`,
  )
  assert.equal(tileResponse.status, 200)
  assert.equal(
    tileResponse.headers.get('content-type'),
    'application/vnd.mapbox-vector-tile',
  )
  assert.deepEqual([...new Uint8Array(await tileResponse.arrayBuffer())], [1, 2, 3])

  const fontResponse = await fetch(
    `${origin}/api/basemap/openfreemap/fonts/Noto%20Sans%20Regular/0-255.pbf`,
  )
  assert.equal(fontResponse.status, 200)
  assert.equal(fontResponse.headers.get('content-type'), 'application/x-protobuf')
  assert.deepEqual([...new Uint8Array(await fontResponse.arrayBuffer())], [4, 5])

  assert.equal(
    calls.filter((url) => url === 'https://tiles.openfreemap.org/planet').length,
    1,
    'TileJSON metadata should be cached for subsequent tile requests',
  )
})

test('OpenFreeMap proxy rejects invalid tile coordinates without contacting upstream', async (t) => {
  let fetchCount = 0
  const app = createApp({
    basemapFetch: async () => {
      fetchCount += 1
      return new Response(null, { status: 500 })
    },
    auditLog: { async record() {} },
  })
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => app.close(resolve)))
  const { port } = app.address()

  const response = await fetch(
    `http://127.0.0.1:${port}/api/basemap/openfreemap/tiles/14/999999/0.pbf`,
  )
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'invalid_basemap_tile')
  assert.equal(fetchCount, 0)
})

test('OpenFreeMap proxy retries a transient upstream response', async (t) => {
  let attempts = 0
  const app = createApp({
    basemapFetch: async (url) => {
      assert.equal(url, 'https://tiles.openfreemap.org/planet')
      attempts += 1
      if (attempts === 1) return new Response(null, { status: 503 })
      return new Response(JSON.stringify({
        tilejson: '3.0.0',
        tiles: [
          'https://tiles.openfreemap.org/planet/version/{z}/{x}/{y}.pbf',
        ],
        minzoom: 0,
        maxzoom: 14,
        vector_layers: [],
      }))
    },
    auditLog: { async record() {} },
  })
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => app.close(resolve)))
  const { port } = app.address()

  const response = await fetch(
    `http://127.0.0.1:${port}/api/basemap/openfreemap/planet`,
  )
  assert.equal(response.status, 200)
  assert.equal(attempts, 2)
})
