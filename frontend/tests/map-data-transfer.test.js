import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectFocusedAssetIds,
  collectSelectedNetworkAssetIds,
  collectViewportAssetIds,
  createContextualExportFilename,
  serializeActiveDatasetKml,
} from '../src/pages/map/active-dataset-kml-export.js'
import { renderMapDataTransferDialog } from '../src/pages/map/map-data-transfer-dialog.js'
import {
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
  assert.match(html, /Layer terlihat ke KML/)
  assert.match(html, /Aset fokus depth 1 ke KML/)
  assert.match(html, /Aset fokus depth 2 ke KML/)
  assert.match(html, /Jalur tracing aktif ke KML/)
  assert.match(html, /Area peta saat ini ke KML/)
  assert.match(html, /value="kmz"/)
  assert.match(html, /File sumber asli/)
  assert.match(html, /Diagram skematik 2D/)
})

test('focused and viewport export scopes remain bounded to graph depth and visible geometry', () => {
  const topologyGraph = {
    edges: [
      { sourceNodeId: 'a', targetNodeId: 'b' },
      { sourceNodeId: 'b', targetNodeId: 'c' },
      { sourceNodeId: 'c', targetNodeId: 'd' },
      { sourceNodeId: 'd', targetNodeId: 'b' },
    ],
  }
  assert.deepEqual(collectFocusedAssetIds(topologyGraph, 'a', 1), ['a', 'b'])
  assert.deepEqual(collectFocusedAssetIds(topologyGraph, 'a', 2), ['a', 'b', 'c', 'd'])

  assert.deepEqual(collectViewportAssetIds([
    { id: 'point', geometry: [{ id: 'point-geometry' }] },
    { id: 'line-owner', geometry: [{ id: 'line-part', sourceGeometryId: 'line-source' }] },
    { id: 'outside', geometry: [{ id: 'outside-geometry' }] },
  ], ['point'], ['line-source']), ['point', 'line-owner'])
})

test('contextual filename uses the site, scope, version, and export date safely', () => {
  assert.equal(createContextualExportFilename({
    siteScopeName: 'Pengapon',
    version: 'v2.4.0',
  }, 'CCTV Trace', '2026-07-29T08:00:00.000Z'), (
    'SINERGI_Pengapon_CCTV-Trace_v2.4.0_2026-07-29'
  ))
})

test('map context and toolbar present a compact branch name and contextual export action', () => {
  const context = renderMapContextPill(activeContext)
  const controls = renderMapFloatingControls()

  assert.match(context, />Semarang</)
  assert.doesNotMatch(context, />Kantor Cabang Semarang</)
  assert.match(controls, />Export</)
  assert.doesNotMatch(controls, /Import \/ Export/)
  assert.match(controls, /data-transfer-toggle/)
})
