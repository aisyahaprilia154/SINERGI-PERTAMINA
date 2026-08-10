import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createNetworkSelectionState,
  parseMapUrlState,
  serializeMapUrlState,
} from '../src/pages/map/network-sidebar-state.js'
import { renderNetworkList, renderNetworkSidebar } from '../src/pages/map/network-sidebar.js'

const validIds = {
  networkIds: ['cctv', 'fiber-optic', 'lan'],
  assetIds: ['SW-PNG-01', 'CCTV-01'],
  defaultNetworkIds: ['cctv', 'fiber-optic'],
}

test('URL state uses defaults only when selectedNetworkIds is absent', () => {
  const defaults = parseMapUrlState('', validIds)
  const hiddenAll = parseMapUrlState('?selectedNetworkIds=', validIds)

  assert.deepEqual(defaults.selectedNetworkIds, ['cctv', 'fiber-optic'])
  assert.deepEqual(hiddenAll.selectedNetworkIds, [])
})

test('URL state keeps only stable identifiers from the active dataset', () => {
  const parsed = parseMapUrlState(
    '?selectedNetworkIds=cctv,other-dataset&selectedAssetId=SW-PNG-01&traceFrom=CCTV-01&traceTo=SW-PNG-01',
    validIds,
  )

  assert.deepEqual(parsed.selectedNetworkIds, ['cctv'])
  assert.equal(parsed.selectedAssetId, 'SW-PNG-01')
  assert.equal(parsed.traceFrom, 'CCTV-01')
  assert.equal(parsed.traceTo, 'SW-PNG-01')
})

test('URL serialization stores small shareable selection values', () => {
  const query = serializeMapUrlState('?view=map', {
    selectedNetworkIds: new Set(['cctv', 'fiber-optic']),
    selectedAssetId: 'SW-PNG-01',
    traceFrom: 'CCTV-01',
    traceTo: 'SW-PNG-01',
  })
  const params = new URLSearchParams(query)

  assert.equal(params.get('view'), 'map')
  assert.equal(params.get('selectedNetworkIds'), 'cctv,fiber-optic')
  assert.equal(params.get('selectedAssetId'), 'SW-PNG-01')
  assert.equal(params.get('traceFrom'), 'CCTV-01')
  assert.equal(params.get('traceTo'), 'SW-PNG-01')
})

test('URL serialization preserves active branch context while selections change', () => {
  const result = serializeMapUrlState(
    '?branchId=semarang&datasetId=dataset-semarang&selectedNetworkIds=old',
    {
      selectedNetworkIds: new Set(['layer:fo', 'layer:cctv']),
      selectedAssetId: 'CCTV-01',
      traceFrom: 'CCTV-01',
      traceTo: 'NVR-01',
    },
  )
  const params = new URLSearchParams(result)

  assert.equal(params.get('branchId'), 'semarang')
  assert.equal(params.get('datasetId'), 'dataset-semarang')
  assert.equal(params.get('selectedNetworkIds'), 'layer:fo,layer:cctv')
  assert.equal(params.get('selectedAssetId'), 'CCTV-01')
  assert.equal(params.get('traceFrom'), 'CCTV-01')
  assert.equal(params.get('traceTo'), 'NVR-01')
})

test('URL state drops trace identifiers outside the active dataset', () => {
  const parsed = parseMapUrlState('?traceFrom=other&traceTo=SW-PNG-01', validIds)
  const query = serializeMapUrlState('', {
    selectedNetworkIds: new Set(['cctv']),
    selectedAssetId: null,
    traceFrom: null,
    traceTo: 'SW-PNG-01',
  })

  assert.equal(parsed.traceFrom, null)
  assert.equal(parsed.traceTo, 'SW-PNG-01')
  assert.equal(new URLSearchParams(query).has('traceTo'), false)
})

test('selection state supports multi-select, show all, hide all, and asset selection', () => {
  const selection = createNetworkSelectionState({
    networkIds: validIds.networkIds,
    assetIds: validIds.assetIds,
    initialSelectedNetworkIds: ['cctv'],
  })

  selection.toggleNetwork('fiber-optic')
  assert.deepEqual([...selection.selectedNetworkIds], ['cctv', 'fiber-optic'])

  selection.hideAllNetworks()
  assert.equal(selection.selectedNetworkIds.size, 0)

  selection.showAllNetworks()
  assert.deepEqual([...selection.selectedNetworkIds], validIds.networkIds)

  selection.selectAsset('SW-PNG-01')
  assert.equal(selection.selectedAssetId, 'SW-PNG-01')
})

test('sidebar search matches asset ID, asset name, and location within a network', () => {
  const html = renderNetworkList({
    status: 'ready',
    networks: [{
      id: 'lan',
      name: 'LAN Kantor',
      type: 'LAN',
      description: 'Jaringan kantor',
      health: 'Aktif',
      color: '#aeb8c5',
      assetCount: 1,
      nodeIds: ['SW-PNG-01'],
      edges: [],
    }],
    assets: [{
      id: 'SW-PNG-01',
      name: 'Switch Pangkal',
      type: 'Access switch',
      location: 'Ruang Server',
    }],
    selectedNetworkIds: new Set(['lan']),
    expandedNetworkIds: new Set(),
    search: 'ruang server',
  })

  assert.match(html, /LAN Kantor/)
  assert.match(html, /data-network-select="lan"/)
})

test('sidebar prioritizes area, search, filters, and networks before compact context', () => {
  const html = renderNetworkSidebar({
    branchId: 'semarang',
    datasetId: 'dataset-semarang',
    datasetName: 'doc · 29 Jul 2026',
  }, 4, {
    networkCount: 4,
    assetNodeCount: 46,
    lineCount: 44,
  }, {
    locationGroups: [{ key: 'booster-kutawinangun', name: 'Booster Kutawinangun' }],
    selectedArea: { key: 'booster-kutawinangun', name: 'Booster Kutawinangun' },
    topologyReadiness: { ready: true, traceAvailable: true },
    topologySummary: {
      confirmedConnectionCount: 34,
      pendingConnectionCount: 1148,
      isolatedAssetCount: 16,
    },
  })

  const areaIndex = html.indexOf('class="area-selector"')
  const searchIndex = html.indexOf('class="search-control"')
  const filterIndex = html.indexOf('class="map-category-presets"')
  const networkIndex = html.indexOf('class="network-list"')
  const contextIndex = html.indexOf('class="sidebar-secondary-context"')

  assert.ok(areaIndex < searchIndex)
  assert.ok(searchIndex < filterIndex)
  assert.ok(filterIndex < networkIndex)
  assert.ok(networkIndex < contextIndex)
  assert.match(html, /title="Tutup panel" aria-label="Tutup panel jaringan"/)
  assert.match(html, /aria-controls="network-sidebar" aria-expanded="true"/)
  assert.match(html, /class="area-selector-control"/)
  assert.match(html, /aria-label="Area fasilitas" aria-haspopup="listbox" aria-expanded="false"/)
  assert.match(html, /area-selector-icon material-symbols-outlined[^>]*[\s\S]*?expand_more/)
  assert.match(html, /placeholder="Cari ID, nama, atau lokasi aset"/)
  assert.match(html, /class="asset-search-combobox"/)
  assert.match(html, /role="combobox" aria-autocomplete="list" aria-haspopup="listbox"/)
  assert.match(html, /role="listbox" aria-label="Hasil pencarian aset"/)
  assert.match(html, /<details class="sidebar-topology-readiness ready">/)
  assert.doesNotMatch(html, /<details class="sidebar-topology-readiness ready" open>/)
  assert.match(html, /class="text-button show-all-networks active" type="button"\s+aria-pressed="true"/)
  assert.match(html, /class="text-button hide-all-networks" type="button"\s+aria-pressed="false"/)
  assert.match(html, /Status topologi/)
  assert.match(html, /34 terkonfirmasi · 16 tanpa relasi/)
  assert.match(html, /1\.148<\/b> perlu diperiksa/)
  assert.match(html, /Tracing menggunakan graph koneksi terkonfirmasi\./)
})

test('network cards expose compact metadata and clear action tooltips', () => {
  const html = renderNetworkList({
    status: 'ready',
    networks: [{
      id: 'cctv',
      name: 'Jaringan CCTV',
      type: 'CCTV',
      description: 'Jaringan kamera',
      health: 'Aktif',
      color: '#64748b',
      assetCount: 36,
      confirmedConnectionCount: 34,
      isolatedAssetCount: 6,
      nodeIds: [],
      edges: [],
    }],
    assets: [],
    selectedNetworkIds: new Set(['cctv']),
    expandedNetworkIds: new Set(),
    search: '',
  })

  assert.match(html, /34 koneksi/)
  assert.match(html, /network-relation-warning/)
  assert.match(html, /title="Fokuskan peta ke Jaringan CCTV"/)
  assert.match(html, /title="Buka detail Jaringan CCTV"/)
})

test('sidebar exposes loading, error, and empty states', () => {
  const base = {
    networks: [],
    assets: [],
    selectedNetworkIds: new Set(),
    expandedNetworkIds: new Set(),
    search: '',
  }

  assert.match(renderNetworkList({ ...base, status: 'loading' }), /network-skeleton/)
  assert.match(renderNetworkList({ ...base, status: 'error' }), /retry-networks/)
  assert.match(renderNetworkList({ ...base, status: 'ready' }), /Jaringan belum tersedia/)
})
