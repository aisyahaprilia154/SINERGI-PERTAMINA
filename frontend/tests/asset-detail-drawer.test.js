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
  assert.match(html, /Telusuri koneksi/)
  assert.match(html, /Relasi aset/)
  assert.match(html, /Buka detail aset/)
  assert.match(html, /Buat diagram 2D/)
  assert.match(html, /asset-status success/)
  assert.match(html, /Online/)
  assert.doesNotMatch(html, /Status tidak tersedia/)
  assert.doesNotMatch(html, /tombol edit|tombol hapus|ubah relasi/i)
})

test('drawer moves an empty recorded operational status into asset information', () => {
  const html = renderAssetDetailDrawer({
    asset: { ...asset, status: null, hasOperationalStatusField: true },
    activeContext,
    trace: { status: 'idle' },
  })

  assert.doesNotMatch(html, /class="asset-status/)
  assert.match(html, /<dt>Status operasional<\/dt><dd>Belum dicatat<\/dd>/)
  assert.doesNotMatch(html, /Status tidak tersedia/)
})

test('drawer omits operational status when the asset model has no status field', () => {
  const { status: _status, ...assetWithoutStatus } = asset
  const html = renderAssetDetailDrawer({
    asset: assetWithoutStatus,
    activeContext,
    trace: { status: 'idle' },
  })

  assert.doesNotMatch(html, /class="asset-status/)
  assert.doesNotMatch(html, /Status operasional/)
  assert.doesNotMatch(html, /Status tidak tersedia/)
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

test('drawer keeps missing relations actionable without the retired review warning', () => {
  const html = renderAssetDetailDrawer({
    asset,
    assetNetworks: [network],
    connectedAssets: [],
    activeContext,
    relationOptions: [{
      asset: { id: 'jb-02', name: 'JB-02', type: 'Junction box' },
      reason: 'Junction box terdekat',
    }],
    trace: { status: 'idle' },
  })

  assert.doesNotMatch(html, /Topologi perlu diperiksa/)
  assert.doesNotMatch(html, /drawer-topology-readiness/)
  assert.match(html, /Relasi aset belum tersedia\./)
  assert.doesNotMatch(html, /class="button primary trace-from"/)
  assert.match(html, /data-open-relation-picker/)
  assert.match(html, /Sambungkan aset/)
  assert.doesNotMatch(html, /Kandidat relasi|Konfirmasi Koneksi/)
})

test('drawer renders the direct relation editor and replacement action', () => {
  const html = renderAssetDetailDrawer({
    asset,
    connectedAssets: [{
      asset: { id: 'jb-01', name: 'JB-01', type: 'Junction box' },
      network,
      relation: { id: 'rel-01' },
    }],
    activeContext,
    relationOptions: [{
      asset: { id: 'jb-02', name: 'JB-02', type: 'Junction box' },
      reason: 'Junction box terdekat',
    }],
    relationEditorOpen: true,
    relationTargetId: 'jb-02',
    relationReplaceId: 'rel-01',
    trace: { status: 'idle' },
  })

  assert.match(html, /Ganti hubungan aset/)
  assert.match(html, /data-relation-target/)
  assert.match(html, /value="jb-02"/)
  assert.match(html, /data-save-relation/)
  assert.match(html, /data-replace-relation="rel-01"/)
})

test('drawer confirms that a saved relation is already visible on the map', () => {
  const html = renderAssetDetailDrawer({
    asset,
    activeContext,
    relationStatus: 'saved',
    trace: { status: 'idle' },
  })

  assert.match(html, /drawer-relation-success/)
  assert.match(html, /Hubungan tersimpan dan sudah ditampilkan pada peta/)
})

test('drawer exposes physical mounting assignment and administrator override controls', () => {
  const html = renderAssetDetailDrawer({
    asset,
    mountedOnAsset: { id: 'pole-01', name: 'Tiang CCTV-01', type: 'Tiang CCTV' },
    mountingOptions: [{
      optionId: 'mount-option-01',
      targetAssetId: 'pole-02',
      targetAssetName: 'Tiang CCTV-02',
      distanceMeters: 1.2,
    }, {
      optionId: 'mount-option-02',
      targetAssetId: 'pole-03',
      targetAssetName: 'Tiang CCTV-03',
      distanceMeters: 1.8,
    }],
    mountingControlsAvailable: true,
    showMountingCandidates: true,
    activeContext,
    trace: { status: 'idle' },
  })

  assert.match(html, /Pemasangan fisik/)
  assert.match(html, /Dipasang pada/)
  assert.match(html, /Tiang CCTV-01/)
  assert.match(html, /data-mounting-action="change"/)
  assert.match(html, /data-mounting-action="detach"/)
  assert.match(html, /data-mounting-pole="pole-02"/)
  assert.match(html, /data-mounting-pole="pole-03"/)
  assert.match(html, /1,2 m/)
  assert.match(html, /data-mounting-search/)
  assert.match(html, /Tiang CCTV-02/)
})

test('pole detail shows installed JB and cameras without the connected-assets section', () => {
  const html = renderAssetDetailDrawer({
    asset: { id: 'pole-18', name: 'T-018', type: 'Tiang' },
    mountedAssets: [
      { id: 'jb-18', name: 'JB-18.1-WP', type: 'Junction Box' },
      { id: 'camera-18', name: 'C-018', type: 'CCTV' },
    ],
    connectedAssets: [{
      asset: { id: 'network-device', name: 'Perangkat jaringan', type: 'Switch' },
      network,
    }],
    activeContext,
    trace: { status: 'idle' },
  })

  assert.match(html, /Pemasangan fisik/)
  assert.match(html, /Aset terpasang/)
  assert.match(html, /JB-18\.1-WP/)
  assert.match(html, /C-018/)
  assert.doesNotMatch(html, /id="connected-assets-title">Aset terhubung/)
  assert.doesNotMatch(html, /id="asset-topology-title">Relasi aset/)
  assert.doesNotMatch(html, /Sambungkan aset/)
})
