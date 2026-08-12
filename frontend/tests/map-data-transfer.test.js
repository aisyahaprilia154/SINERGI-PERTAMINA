import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectSelectedNetworkAssetIds,
  serializeActiveDatasetKml,
} from '../src/pages/map/active-dataset-kml-export.js'
import {
  renderMapDataTransferDialog,
  resolveConfiguredImportTarget,
} from '../src/pages/map/map-data-transfer-dialog.js'
import {
  renderNetworkMapCanvas,
  renderMapContextPill,
  renderMapFloatingControls,
} from '../src/pages/map/map-surface.js'

const activeContext = {
  branchId: 'semarang',
  branchName: 'Kantor Cabang Semarang',
  datasetId: 'dataset-semarang',
  datasetVersionId: 'dv-active',
  version: 'v12',
  sourceFilename: 'jaringan.kmz',
}

const assets = [{
  id: 'CCTV-01',
  name: 'CCTV Lobby & Utama',
  category: 'CCTV',
  type: 'CCTV',
  location: 'Lobby <Barat>',
  geometry: [{
    geometryType: 'point',
    coordinates: [110.42, -6.99, 5],
  }],
}, {
  id: 'FO-01',
  name: 'Backbone FO',
  category: 'Fiber Optic',
  type: 'Fiber Optic',
  location: 'Gedung A',
  geometry: [{
    geometryType: 'line_string',
    coordinates: [[110.42, -6.99], [110.43, -7]],
  }],
}]

test('map import resolves stale display context to the canonical configured branch', () => {
  const target = resolveConfiguredImportTarget({
    branchId: 'Semarang',
    branchName: 'Kantor Cabang Semarang',
    datasetId: 'legacy-dataset-id',
  }, {
    branches: [{ id: 'semarang', name: 'Semarang', datasetId: 'dataset-semarang' }],
  })

  assert.deepEqual(target, {
    id: 'semarang',
    name: 'Semarang',
    datasetId: 'dataset-semarang',
  })
})

test('active dataset KML export preserves geographic coordinate order and metadata', () => {
  const kml = serializeActiveDatasetKml({ activeContext, assets })

  assert.match(kml, /110\.42,-6\.99,5/)
  assert.match(kml, /110\.43,-7/)
  assert.match(kml, /CCTV Lobby &amp; Utama/)
  assert.match(kml, /Lobby &lt;Barat&gt;/)
  assert.match(kml, /<LineString>/)
  assert.doesNotMatch(kml, /-6\.99,110\.42/)
})

test('selected network KML scope uses stable network identifiers', () => {
  const ids = collectSelectedNetworkAssetIds([{
    id: 'cctv',
    nodeIds: ['CCTV-01'],
  }, {
    id: 'fiber-optic',
    nodeIds: ['FO-01', 'CCTV-01'],
  }], new Set(['fiber-optic']))

  assert.deepEqual(ids, ['FO-01', 'CCTV-01'])
  const kml = serializeActiveDatasetKml({
    activeContext,
    assets,
    assetIds: ids,
  })
  assert.match(kml, /FO-01/)
  assert.match(kml, /CCTV-01/)
})

test('map data transfer dialog exposes direct import and complete export choices', () => {
  const html = renderMapDataTransferDialog({
    activeContext,
    assets,
    networks: [{
      id: 'cctv',
      nodeIds: ['CCTV-01'],
    }],
    selectedNetworkIds: new Set(['cctv']),
    state: {
      mode: 'export',
      configStatus: 'ready',
      config: { limits: { maxFileSize: 50 * 1024 * 1024 } },
      versionName: 'Import jaringan',
      officialSourceConfirmed: false,
      phase: 'idle',
      error: null,
    },
  })

  assert.match(html, /Import KML\/KMZ/)
  assert.match(html, /Dataset aktif ke KML/)
  assert.match(html, /Jaringan terpilih ke KML/)
  assert.match(html, /File sumber asli/)
  assert.match(html, /Diagram skematik 2D/)
})

test('map context and toolbar present compact professional map actions', () => {
  const context = renderMapContextPill(activeContext, null, { name: 'Booster Kutawinangun' }, {
    counts: { assetNodeCount: 98, lineCount: 62 },
    confirmedConnectionCount: 62,
  })
  const controls = renderMapFloatingControls()

  assert.match(context, />Semarang</)
  assert.doesNotMatch(context, />Kantor Cabang Semarang</)
  assert.match(context, />Area</)
  assert.match(context, />Booster Kutawinangun</)
  assert.match(context, /98 aset &middot; 62 jalur &middot; 62 koneksi terkonfirmasi/)
  assert.doesNotMatch(context, /PETA KERJA/)
  assert.match(controls, /class="tool-button import-toggle map-action-ghost"/)
  assert.match(controls, /aria-label="Import" title="Import data peta"/)
  assert.match(controls, /upload_file/)
  assert.match(controls, />Import</)
  assert.match(controls, />Export</)
  assert.match(controls, />Tracing</)
  assert.match(controls, />Diagram 2D</)
  assert.match(controls, /class="tool-button export-toggle map-action-ghost"/)
  assert.match(controls, /aria-label="Export" title="Export data peta"/)
  assert.match(controls, />Export</)
  assert.match(controls, /class="open-sidebar sidebar-reopen"/)
  assert.match(controls, /title="Buka panel"/)
  assert.match(controls, /aria-label="Buka panel jaringan"[^>]*aria-expanded="false"/)
  assert.doesNotMatch(controls, /Lainnya|map-more-menu|map-more-popover/)
  assert.doesNotMatch(controls, /Kelola Dataset|Rapikan tampilan|manage-dataset-toggle|declutter-toggle/)
  assert.match(controls, /Klik lalu pilih aset awal pada peta\./)
  assert.doesNotMatch(controls, /class="tool-button trace-toggle"[^>]*\bdisabled\b/)
  assert.doesNotMatch(controls, /Import \/ Export/)
  assert.match(controls, /basemap-toggle/)
  assert.doesNotMatch(controls, /map-asset-results/)
  assert.ok(controls.indexOf('trace-toggle') < controls.indexOf('diagram-toggle'))
  assert.ok(controls.indexOf('diagram-toggle') < controls.indexOf('import-toggle'))
  assert.ok(controls.indexOf('import-toggle') < controls.indexOf('export-toggle'))
})

test('map disables unavailable tracing and displays an Indonesian readiness status', () => {
  const topologyReadiness = {
    ready: false,
    message: 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.',
  }
  const context = renderMapContextPill(activeContext, topologyReadiness)
  const controls = renderMapFloatingControls(activeContext, topologyReadiness)

  assert.match(context, /Topologi perlu diperiksa/)
  assert.match(controls, /class="tool-button trace-toggle map-action-primary"[^>]*title="Topologi site ini belum siap untuk tracing\. Data koneksi masih dalam review\."/)
  assert.match(controls, /class="tool-button trace-toggle map-action-primary"[^>]*disabled aria-disabled="true"/)
  assert.match(controls, /class="tool-button diagram-toggle map-action-secondary"[^>]*disabled aria-disabled="true"/)
  assert.match(controls, /Topologi site ini belum siap untuk tracing\. Data koneksi masih dalam review\./)
})

test('map renders topology warning as a distinct readable callout', () => {
  const html = renderNetworkMapCanvas(activeContext, {
    topologyReadiness: {
      ready: false,
      traceAvailable: false,
      message: 'Belum ada koneksi yang dikonfirmasi.',
    },
  })

  assert.match(html, /class="map-topology-readiness"/)
  assert.match(html, /material-symbols-outlined" aria-hidden="true">warning/)
  assert.match(html, /<strong>Topologi perlu diperiksa<\/strong>/)
  assert.match(html, /Belum ada koneksi yang dikonfirmasi\./)
})

test('export dialog also disables the diagram entry point while topology is unready', () => {
  const html = renderMapDataTransferDialog({
    activeContext,
    assets,
    networks: [{ id: 'cctv', nodeIds: ['CCTV-01'] }],
    selectedNetworkIds: new Set(['cctv']),
    topologyReady: false,
    topologyMessage: 'Topologi site ini belum siap untuk tracing. Data koneksi masih dalam review.',
    state: {
      mode: 'export',
      configStatus: 'ready',
      config: { limits: { maxFileSize: 50 * 1024 * 1024 } },
      versionName: 'Export',
      officialSourceConfirmed: false,
      phase: 'idle',
      error: null,
    },
  })

  assert.match(html, /class="button secondary open-map-diagram"[^>]*disabled aria-disabled="true"/)
  assert.match(html, /Topologi site ini belum siap untuk tracing\. Data koneksi masih dalam review\./)
})
