import assert from 'node:assert/strict'
import test from 'node:test'
import { assetIconUrl, assetIconCanReset } from '../src/domain/asset-icon.js'
import { renderAssetDetailDrawer } from '../src/pages/map/asset-detail-drawer.js'
import { validateAssetIconFile } from '../src/pages/map/asset-icon-editor.js'
import { adaptActiveAssetDetail } from '../src/adapters/active-dataset-map-adapter.js'

test('custom icons take precedence for every asset type and reset suppresses imported icons', () => {
  const camera = { type: 'CCTV', sourceIconUrl: '/source', customIconUrl: '/custom' }
  assert.equal(assetIconUrl(camera), '/custom')
  assert.equal(assetIconUrl({ ...camera, type: 'Junction box' }), '/custom')
  const reset = { ...camera, customIconUrl: null, iconReset: true }
  assert.equal(assetIconUrl(reset), null)
  assert.equal(assetIconCanReset(reset), false)
  assert.equal(assetIconUrl({ ...reset, type: 'Junction box' }), '/icons/junction-box.png')
})

test('detail refresh respects a reset from another session', () => {
  const asset = { id: 'cam', type: 'CCTV', customIconUrl: '/old' }
  const detail = adaptActiveAssetDetail({ asset: { assetId: 'cam', type: 'CCTV', customIconUrl: null, iconReset: true } }, asset)
  assert.equal(assetIconUrl(detail), null)
})

test('drawer icon controls use the loaded preview and offer reset only for a custom or imported icon', () => {
  const asset = { id: 'cam', name: 'Kamera', type: 'CCTV', customIconUrl: '/custom' }
  const html = renderAssetDetailDrawer({ asset, iconControlsAvailable: true,
    sourceIconDataByUrl: new Map([['/custom', 'data:image/png;base64,preview']]) })
  assert.match(html, /data-asset-icon-trigger/)
  assert.match(html, /src="data:image\/png;base64,preview"/)
  assert.match(html, /data-reset-asset-icon/)
  assert.ok(html.indexOf('asset-icon-control') < html.indexOf('asset-badge-row'))
  const reset = renderAssetDetailDrawer({ asset: { ...asset, customIconUrl: null, iconReset: true }, iconControlsAvailable: true })
  assert.doesNotMatch(reset, /data-reset-asset-icon/)
})

test('icon picker rejects unsupported and oversized uploads before decoding', () => {
  assert.throws(() => validateAssetIconFile({ type: 'image/svg+xml', size: 30 }))
  assert.throws(() => validateAssetIconFile({ type: 'image/png', size: 6 * 1024 * 1024 }))
  assert.doesNotThrow(() => validateAssetIconFile({ type: 'image/webp', size: 1000 }))
})
