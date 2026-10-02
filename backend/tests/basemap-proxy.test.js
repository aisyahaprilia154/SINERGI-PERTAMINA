import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createApp } from '../src/app.js'
import { createOpenFreeMapProxy } from '../src/http/openfreemap-proxy.js'

test('OpenFreeMap proxy rewrites TileJSON and serves tiles and fonts from same origin', {
  timeout: 30_000,
}, async (t) => {
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
    '/api/basemap/openfreemap/tiles/20260621_080001_pt/{z}/{x}/{y}.pbf',
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

test('tile requests share one download, use gzip/ETag, and survive backend restart without upstream access', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'sinergi-basemap-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const payload=Buffer.from('vector tile geometry '.repeat(5000))
  let downloads=0
  const options={config:{dataRoot:root},auditLog:{record:async()=>{}},basemapFetch:async url=>{
    assert.equal(url,'https://tiles.openfreemap.org/planet/snapshot_1/14/13217/8511.pbf')
    downloads++
    return new Response(payload)
  }}
  const open=async options=>{
    const app=createApp(options)
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve))
    t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve))})
    return {app,url:`http://127.0.0.1:${app.address().port}/api/basemap/openfreemap/tiles/snapshot_1/14/13217/8511.pbf`}
  }
  const first=await open(options)
  const responses=await Promise.all(Array.from({length:8},()=>fetch(first.url)))
  for(const response of responses){
    assert.equal(response.status,200)
    assert.equal(response.headers.get('content-encoding'),'gzip')
    assert.ok(Number(response.headers.get('content-length')) < payload.length/10)
    assert.equal(response.headers.get('vary'),'Accept-Encoding')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload)
  }
  assert.equal(downloads,1)
  const etag=responses[0].headers.get('etag')
  const unchanged=await fetch(first.url,{headers:{'if-none-match':etag}})
  assert.equal(unchanged.status,304)
  assert.equal((await unchanged.arrayBuffer()).byteLength,0)
  const identity=await fetch(first.url,{headers:{'accept-encoding':'gzip;q=0'}})
  assert.equal(identity.headers.get('content-encoding'),null)
  assert.equal(Number(identity.headers.get('content-length')),payload.length)
  assert.deepEqual(Buffer.from(await identity.arrayBuffer()),payload)
  first.app.closeAllConnections()
  await new Promise(resolve=>first.app.close(resolve))
  const second=await open({...options,basemapFetch:async()=>{throw new Error('upstream should not be needed')}})
  const restored=await fetch(second.url)
  assert.equal(restored.status,200)
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()),payload)
  assert.equal(restored.headers.get('etag'),etag)
})

test('metadata rollover changes the local tile URL while old snapshot requests remain consistent', async t=>{
  let timestamp=0,revision=1,metadataDownloads=0
  const proxy=createOpenFreeMapProxy({now:()=>timestamp,fetchImpl:async url=>{
    if(url==='https://tiles.openfreemap.org/planet'){
      metadataDownloads++
      return new Response(JSON.stringify({tiles:[`https://tiles.openfreemap.org/planet/snapshot_${revision}/{z}/{x}/{y}.pbf`]}))
    }
    return new Response(Buffer.from(url))
  }})
  const app=http.createServer((request,response)=>{
    proxy.handle(new URL(request.url,'http://localhost').pathname,response,request)
      .catch(()=>{response.writeHead(502);response.end()})
  })
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve))})
  const origin=`http://127.0.0.1:${app.address().port}`
  const first=await Promise.all(Array.from({length:4},async()=> (await fetch(origin+'/api/basemap/openfreemap/planet')).json()))
  assert.equal(metadataDownloads,1)
  const old=first[0].tiles[0].replace('{z}','1').replace('{x}','0').replace('{y}','0')
  revision=2;timestamp=6*60*60*1000+1
  const current=await (await fetch(origin+'/api/basemap/openfreemap/planet')).json()
  assert.notEqual(current.tiles[0],first[0].tiles[0])
  const tile=await fetch(origin+old)
  assert.match(await tile.text(),/snapshot_1/)
  assert.match(tile.headers.get('cache-control'),/immutable/)
  const legacy=await fetch(origin+'/api/basemap/openfreemap/tiles/1/0/0.pbf')
  assert.match(await legacy.text(),/snapshot_2/)
  assert.equal(legacy.headers.get('cache-control'),'public, max-age=300')
})

test('OpenFreeMap proxy rejects invalid tile coordinates without contacting upstream', {
  timeout: 30_000,
}, async (t) => {
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

test('OpenFreeMap proxy retries a transient upstream response', {
  timeout: 30_000,
}, async (t) => {
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
