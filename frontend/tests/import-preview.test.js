import assert from 'node:assert/strict'
import test from 'node:test'
import { renderPreviewMapCanvas, previewMapInternals } from '../src/pages/admin/preview-map-canvas.js'
import { renderActivationBar } from '../src/pages/admin/preview-import-page.js'
import { renderPreviewToolbar } from '../src/pages/admin/preview-toolbar.js'
import { parseAttachmentFilename } from '../src/services/import-dataset-service.js'
import {
  buildImportPreviewModel,
  calculateAssetBounds,
  createImportPreviewState,
  findConnectedAssetIds,
  getVisiblePreviewData,
} from '../src/pages/admin/preview-import-state.js'

const payload = {
  datasetVersion: {
    id: 'version-2',
    branchId: 'semarang',
    versionName: 'Import Juli 2026',
    sourceFilename: 'network.kml',
    sourceSize: 1536,
    checksum: `sha256:${'a'.repeat(64)}`,
    importedBy: 'admin-1',
    importedAt: '2026-07-28T09:00:00.000Z',
  },
  layers: [{ id: 'layer-1', name: 'Network', datasetVersionId: 'version-2' }],
  assets: [
    asset('node-a', 'A', 'Switch', 'Infrastructure'),
    asset('node-b', 'B', 'CCTV', 'CCTV'),
  ],
  geometries: [
    point('geometry-a', 'node-a', 110, -7),
    point('geometry-b', 'node-b', 110.01, -7.01),
    {
      id: 'line-b',
      assetNodeId: 'node-b',
      geometryType: 'line_string',
      coordinates: [[110, -7], [110.01, -7.01]],
    },
  ],
  relations: [{
    id: 'relation-a-b',
    sourceAssetId: 'A',
    targetAssetId: 'B',
    relationType: 'connected_to',
  }],
  issues: [{
    id: 'issue-b',
    severity: 'warning',
    issueCode: 'CATEGORY_UNMAPPED',
    message: 'Category needs review.',
    assetId: 'B',
    canActivate: true,
  }],
  comparison: {
    assetChanges: [
      { assetId: 'A', status: 'updated' },
      { assetId: 'B', status: 'new' },
    ],
    removedAssets: [{
      asset: asset('node-c-old', 'C', 'Printer', 'Peripheral'),
      geometries: [point('geometry-c-old', 'node-c-old', 110.02, -7.02)],
      status: 'removed',
    }],
    summary: {
      newAssets: 1,
      updatedAssets: 1,
      unchangedAssets: 0,
      removedAssets: 1,
    },
  },
  activeDatasetVersion: null,
}

test('preview model binds changes, issues, layers, and removed geometry without mutation', () => {
  const model = buildImportPreviewModel(payload)

  assert.equal(model.candidate.assetsByAssetId.get('A').changeStatus, 'updated')
  assert.equal(model.candidate.assetsByAssetId.get('B').issues[0].id, 'issue-b')
  assert.equal(model.removed.assets[0].changeStatus, 'removed')
  assert.deepEqual(payload.assets[0].properties, {})
})

test('filters keep candidate data inside selected layer, category, and geometry type', () => {
  const model = buildImportPreviewModel(payload)
  const state = createImportPreviewState(model)
  state.visibleCategories.delete('CCTV')
  state.visibleGeometryTypes.delete('line_string')
  state.showChanges = false
  const visible = getVisiblePreviewData(model, state)

  assert.deepEqual(visible.assets.map(({ assetId }) => assetId), ['A'])
  assert.deepEqual(visible.geometries.map(({ geometryType }) => geometryType), ['point'])
})

test('issue focus bounds preserve longitude-latitude orientation', () => {
  const model = buildImportPreviewModel(payload)
  const bounds = calculateAssetBounds(model, 'B')

  assert.ok(bounds.west < 110)
  assert.ok(bounds.east > 110.01)
  assert.ok(bounds.south < -7.01)
  assert.ok(bounds.north > -7)
})

test('connected traversal follows explicit relation only and is cycle-safe', () => {
  const model = buildImportPreviewModel({
    ...payload,
    assets: [...payload.assets, asset('node-nearby', 'NEARBY', 'CCTV', 'CCTV')],
    relations: [
      ...payload.relations,
      {
        id: 'relation-b-a',
        sourceAssetId: 'B',
        targetAssetId: 'A',
        relationType: 'connected_to',
      },
    ],
  })

  assert.deepEqual([...findConnectedAssetIds(model, 'A')].sort(), ['A', 'B'])
  assert.deepEqual([...findConnectedAssetIds(model, 'NEARBY')], ['NEARBY'])
})

test('SVG renderer exposes keyboard targets and non-color change cues', () => {
  const model = buildImportPreviewModel(payload)
  const state = createImportPreviewState(model)
  const html = renderPreviewMapCanvas({
    visible: getVisiblePreviewData(model, state),
    state,
  })

  assert.match(html, /role="button"/)
  assert.match(html, /change-updated/)
  assert.match(html, /change-new/)
  assert.match(html, /change-removed/)
  assert.match(html, /node-change-glyph/)
  assert.match(html, /Peta preview/)
})

test('far-zoom simplification retains the first and last coordinate', () => {
  const positions = Array.from({ length: 201 }, (_, index) => [index, index])
  const simplified = previewMapInternals.simplifyPositions(positions, 1)

  assert.deepEqual(simplified[0], positions[0])
  assert.deepEqual(simplified.at(-1), positions.at(-1))
  assert.ok(simplified.length < positions.length)
})

test('active map link only appears after server-confirmed activation state', () => {
  const model = buildImportPreviewModel(payload)
  const state = createImportPreviewState(model)
  assert.doesNotMatch(renderPreviewToolbar({ model, state }), /Buka map dataset aktif/)

  state.activeMapUrl = '/map'
  assert.match(renderPreviewToolbar({ model, state }), /Buka map dataset aktif/)
})

test('version detail distinguishes original source download from validation export', () => {
  const model = buildImportPreviewModel(payload)
  const state = createImportPreviewState(model)
  const html = renderActivationBar(model, state)

  assert.match(html, /Source filename/)
  assert.match(html, /network\.kml/)
  assert.match(html, /1\.5 KB/)
  assert.match(html, /sha256:aaaaaaaaaaaa/)
  assert.match(html, /admin-1/)
  assert.match(html, /Unduh file sumber/)
  assert.match(html, /bukan export dataset/)
  assert.match(html, /Unduh laporan/)
})

test('attachment filename prefers UTF-8 Content-Disposition safely', () => {
  assert.equal(
    parseAttachmentFilename(
      'attachment; filename="network.kml"; filename*=UTF-8\'\'jaringan%20resmi.kml',
      'fallback.kml',
    ),
    'jaringan resmi.kml',
  )
  assert.equal(
    parseAttachmentFilename('attachment; filename="network.kmz"', 'fallback.kmz'),
    'network.kmz',
  )
  assert.equal(
    parseAttachmentFilename(
      'attachment; filename="../storage/private/source.kml"',
      'fallback.kml',
    ),
    'source.kml',
  )
})

function asset(id, assetId, type, category) {
  return {
    id,
    assetId,
    name: `${type} ${assetId}`,
    type,
    category,
    layerId: 'layer-1',
    branchId: 'semarang',
    properties: {},
  }
}

function point(id, assetNodeId, longitude, latitude) {
  return {
    id,
    assetNodeId,
    geometryType: 'point',
    coordinates: [longitude, latitude],
  }
}
