import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { renderMapDataTransferDialog } from '../src/pages/map/map-data-transfer-dialog.js'
import { renderNetworkMapSurface } from '../src/pages/map/map-surface.js'
import {
  deriveMapToolbarAvailability,
  findSelectedLineOnlyNetworks,
} from '../src/pages/map/map-toolbar-state.js'

test('approved map shell exposes Export-only toolbar and polished map controls', () => {
  const html = renderNetworkMapSurface({
    branchName: 'Pengapon',
    siteScopeName: 'Pengapon',
    version: 'doc · 29 Jul 2026',
  })

  assert.match(html, />Export</)
  assert.doesNotMatch(html, /Import \/ Export/)
  assert.doesNotMatch(html, /dim-toggle|Redupkan lainnya/)
  assert.match(html, /class="tool-button trace-toggle"[^>]*disabled/)
  assert.match(html, /class="tool-button diagram-toggle"[^>]*disabled/)
  assert.match(html, /class="zoom-fit"/)
  assert.match(html, /class="zoom-reset"/)
  assert.match(html, /class="[^"]*legend-toggle[^"]*"/)
})

test('compact legend explains network color, asset shape, selection, and inference', () => {
  const html = renderNetworkMapSurface({
    branchName: 'Pengapon',
    version: 'v1',
  })
  for (const label of [
    'CCTV',
    'Fiber Optic',
    'LAN',
    'Infrastruktur',
    'Peripheral',
    'Junction',
    'Switch / server',
    'Aset terpilih',
    'Relasi terkonfirmasi',
  ]) {
    assert.match(html, new RegExp(label.replace('/', '\\/')))
  }
  assert.match(html, /warna menunjukkan jaringan, bentuk menunjukkan fungsi aset/i)
})

test('tracing needs a selected graph node and diagram needs an edge in scope', () => {
  const topologyGraph = {
    edges: [{
      id: 'edge-1',
      sourceNodeId: 'A',
      targetNodeId: 'B',
      networkId: 'network:cctv',
      relationSource: 'explicit',
      relationStatus: 'explicit_confirmed',
    }],
    nodes: [{ id: 'A' }, { id: 'B' }],
  }
  const idle = deriveMapToolbarAvailability({
    selectedAssetId: null,
    selectedNetworkIds: ['network:cctv'],
    topologyGraph,
  })
  assert.equal(idle.traceEnabled, false)
  assert.equal(idle.diagramEnabled, true)

  const selected = deriveMapToolbarAvailability({
    selectedAssetId: 'A',
    selectedNetworkIds: ['network:cctv'],
    topologyGraph,
  })
  assert.equal(selected.traceEnabled, true)
  assert.equal(selected.diagramEnabled, true)

  const emptyScope = deriveMapToolbarAvailability({
    selectedAssetId: null,
    selectedNetworkIds: ['network:lan'],
    topologyGraph,
  })
  assert.equal(emptyScope.diagramEnabled, false)
  assert.match(emptyScope.diagramReason, /relasi yang telah dikonfirmasi/)
})

test('Administrator can open a pending topology preview without enabling User tracing', () => {
  const topologyGraph = {
    nodes: [{ id: 'A' }, { id: 'B' }],
    edges: [],
    candidateEdges: [{
      id: 'pending-1',
      sourceNodeId: 'A',
      targetNodeId: 'B',
      networkId: 'network:fiber-optic',
      relationSource: 'inferred_endpoint',
      relationStatus: 'inferred_pending',
    }],
  }
  const user = deriveMapToolbarAvailability({
    selectedNetworkIds: ['network:fiber-optic'],
    topologyGraph,
  })
  const administrator = deriveMapToolbarAvailability({
    selectedNetworkIds: ['network:fiber-optic'],
    topologyGraph,
    isAdministrator: true,
  })

  assert.equal(user.diagramEnabled, false)
  assert.equal(administrator.diagramEnabled, true)
  assert.equal(administrator.diagramPreviewOnly, true)
  assert.equal(administrator.traceEnabled, false)
})

test('line-only selected network produces the explicit incomplete-topology notice state', () => {
  const networks = [{
    id: 'network:fiber-optic',
    name: 'Jaringan Fiber Optic',
    lineCount: 8,
    nodeCount: 0,
  }, {
    id: 'network:cctv',
    name: 'Jaringan CCTV',
    lineCount: 4,
    nodeCount: 6,
  }]
  assert.deepEqual(
    findSelectedLineOnlyNetworks(networks, ['network:fiber-optic', 'network:cctv'])
      .map(({ id }) => id),
    ['network:fiber-optic'],
  )
})

test('map export entry does not expose the import tab', () => {
  const html = renderMapDataTransferDialog({
    activeContext: {
      branchName: 'Pengapon',
      branchId: 'semarang',
      datasetId: 'dataset-semarang',
      datasetVersionId: 'version-1',
      sourceFilename: 'doc.kml',
      version: 'v1',
    },
    assets: [],
    networks: [],
    selectedNetworkIds: new Set(),
    allowImport: false,
    state: {
      mode: 'export',
      exportFormat: 'kml',
      error: null,
      exportStatus: null,
    },
  })
  assert.match(html, /<h2>Export peta<\/h2>/)
  assert.doesNotMatch(html, /data-transfer-mode="import"/)
  assert.doesNotMatch(html, /Import KML\/KMZ/)
})

test('basemap and controls stay neutral, accessible, and provider-attributed', async () => {
  const css = await readFile(
    new URL('../src/styles/leaflet-overrides.css', import.meta.url),
    'utf8',
  )
  const controlsCss = await readFile(
    new URL('../src/styles/map.css', import.meta.url),
    'utf8',
  )
  const [renderer, basemap] = await Promise.all([
    readFile(
      new URL('../src/pages/map/leaflet-map-renderer.js', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/pages/map/leaflet-basemap.js', import.meta.url),
      'utf8',
    ),
  ])

  assert.match(css, /\.leaflet-tile-pane[\s\S]*grayscale/)
  assert.match(css, /\.leaflet-control-attribution/)
  assert.match(controlsCss, /zoom-controls button:focus-visible/)
  assert.match(controlsCss, /border-radius: var\(--radius-md\)/)
  assert.match(renderer, /createLeafletBasemapManager/)
  assert.match(renderer, /Semua basemap gagal dimuat/)
  assert.match(basemap, /activeLayer\.on\('tileerror'/)
  assert.match(basemap, /activate\(index \+ 1, 'tile-error'\)/)
})
