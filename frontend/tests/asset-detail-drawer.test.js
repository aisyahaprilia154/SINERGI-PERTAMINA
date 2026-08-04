import assert from 'node:assert/strict'
import test from 'node:test'
import { renderAssetDetailDrawer } from '../src/pages/map/asset-detail-drawer.js'

const asset = {
  id: 'cam-01',
  name: 'CCTV-GATE-01',
  type: 'CCTV',
  status: 'Online',
  location: 'Gerbang Utama',
  ip: '10.42.3.31',
  owner: 'Security Operation',
}
const activeContext = {
  branchName: 'Kantor Cabang Semarang',
  datasetName: 'SMG Network Master',
  version: 'v12',
  publishedAt: '21 Jul 2026',
}
const network = {
  id: 'cctv-ring',
  name: 'CCTV Ring',
  shortName: 'CCTV Ring',
  type: 'CCTV',
  color: '#9698f4',
}

test('drawer exposes read-only asset, network, relation, and action details', () => {
  const html = renderAssetDetailDrawer({
    asset,
    assetNetworks: [network],
    connectedAssets: [{
      asset: { ...asset, id: 'jb-01', name: 'JB-CCTV-01', type: 'Junction box' },
      network,
    }],
    activeContext,
    trace: { status: 'idle' },
  })

  assert.match(html, /cam-01/)
  assert.match(html, /CCTV-GATE-01/)
  assert.match(html, /10\.42\.3\.31/)
  assert.match(html, /SMG Network Master/)
  assert.match(html, /JB-CCTV-01/)
  assert.match(html, /Telusuri jaringan/)
  assert.match(html, /Buka detail aset/)
  assert.match(html, /Buat diagram 2D/)
  assert.doesNotMatch(html, /tombol edit|tombol hapus|ubah relasi/i)
})

test('drawer renders an explainable ordered trace', () => {
  const html = renderAssetDetailDrawer({
    asset,
    assetNetworks: [network],
    connectedAssets: [],
    activeContext,
    trace: {
      status: 'active',
      explanation: 'Jalur terpendek berdasarkan relasi eksplisit.',
      sourceAssetId: 'cam-01',
      targetAssetId: 'jb-01',
      hopCount: 1,
      totalLengthMeters: 42,
      networkFamily: 'CCTV',
      graphRevision: 'topology-graph:abc',
      verifiedAt: '2026-08-03T10:00:00.000Z',
      pathAssets: [
        asset,
        { ...asset, id: 'jb-01', name: 'JB-CCTV-01', type: 'Junction box' },
      ],
      relations: [{
        networkName: 'CCTV Ring',
        pathAssetIds: ['cable-01'],
        sourceGeometryIds: ['geometry-01'],
      }],
    },
  })

  assert.match(html, /Jalur koneksi/)
  assert.match(html, /Jalur terpendek berdasarkan relasi eksplisit/)
  assert.match(html, /topology-graph:abc/)
  assert.match(html, /cable-01/)
  assert.match(html, /geometry-01/)
  assert.match(html, /Hentikan tracing/)
  assert.doesNotMatch(html, /disabled aria-disabled="true"/)
})

test('drawer supports loading and error states', () => {
  const loading = renderAssetDetailDrawer({ status: 'loading' })
  const error = renderAssetDetailDrawer({
    status: 'error',
    errorMessage: 'Dataset tidak tersedia.',
  })

  assert.match(loading, /aria-busy="true"/)
  assert.match(error, /Dataset tidak tersedia/)
  assert.match(error, /Coba lagi/)
})

test('drawer disables tracing and explains when the selected asset is not topology-ready', () => {
  const html = renderAssetDetailDrawer({
    asset,
    assetNetworks: [network],
    connectedAssets: [],
    activeContext,
    topologyReady: false,
    topologyMessage: 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.',
    trace: { status: 'idle' },
  })

  assert.match(html, /Relasi aset belum tersedia/)
  assert.match(html, /trace-from[^>]*disabled/)
  assert.match(html, /class="button primary trace-from"[^>]*title="Topologi site ini belum siap untuk tracing\. Data koneksi masih dalam review\."/)
  assert.match(html, /class="button secondary open-schematic"[^>]*disabled aria-disabled="true"/)
  assert.match(html, /Topologi site ini belum siap untuk tracing\. Data koneksi masih dalam review\./)
})
