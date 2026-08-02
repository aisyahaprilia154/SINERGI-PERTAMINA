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
      relation: {
        relationType: 'connected-to',
        relationStatus: 'explicit_confirmed',
      },
    }],
    activeContext,
    trace: { status: 'idle' },
    relationReadiness: {
      canTrace: true,
      canCreateDiagram: true,
    },
  })

  assert.match(html, /cam-01/)
  assert.match(html, /CCTV-GATE-01/)
  assert.match(html, /10\.42\.3\.31/)
  assert.match(html, /SMG Network Master/)
  assert.match(html, /JB-CCTV-01/)
  assert.match(html, /Telusuri koneksi/)
  assert.match(html, /Buka detail aset/)
  assert.match(html, /Buat diagram 2D/)
  assert.doesNotMatch(html, /tombol edit|tombol hapus|ubah relasi/i)
})

test('isolated asset explains relation unavailability and exposes Admin review', () => {
  const html = renderAssetDetailDrawer({
    asset,
    assetNetworks: [network],
    connectedAssets: [],
    activeContext,
    trace: { status: 'idle' },
    relationReadiness: {
      canTrace: false,
      canCreateDiagram: false,
    },
    isAdministrator: true,
  })

  assert.match(
    html,
    /Relasi aset belum tersedia\. Lokasi dan metadata aset tetap dapat dilihat\./,
  )
  assert.match(html, /Periksa kandidat relasi/)
  assert.match(html, /class="button primary trace-from"[\s\S]*disabled/)
})

test('Admin can open a pending relation preview from the asset drawer', () => {
  const html = renderAssetDetailDrawer({
    asset,
    assetNetworks: [network],
    connectedAssets: [],
    activeContext,
    relationReadiness: {
      canTrace: false,
      canCreateDiagram: false,
      pendingEdgeCount: 2,
    },
    isAdministrator: true,
  })

  assert.match(html, /Preview diagram 2D/)
  assert.doesNotMatch(html, /open-schematic"[^>]*disabled/)
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
      pathAssets: [
        asset,
        { ...asset, id: 'jb-01', name: 'JB-CCTV-01', type: 'Junction box' },
      ],
      relations: [{ networkName: 'CCTV Ring' }],
    },
  })

  assert.match(html, /Jalur koneksi/)
  assert.match(html, /Jalur terpendek berdasarkan relasi eksplisit/)
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
