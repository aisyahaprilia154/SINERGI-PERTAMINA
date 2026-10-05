import assert from 'node:assert/strict'
import test from 'node:test'
import { assetIconUrl, assetIconCanReset } from '../src/domain/asset-icon.js'
import { renderAssetDetailDrawer } from '../src/pages/map/asset-detail-drawer.js'
import { validateAssetIconFile } from '../src/pages/map/asset-icon-editor.js'
import { adaptActiveAssetDetail } from '../src/adapters/active-dataset-map-adapter.js'
import { isAdministrator, loadCurrentUser, getSessionUser, saveSession } from '../src/services/account-session.js'

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

test('administrator menu stays consistent across custom, imported, and default icons', () => {
  const asset = { id: 'cam', name: 'Kamera', type: 'CCTV', customIconUrl: '/custom' }
  const html = renderAssetDetailDrawer({ asset, iconControlsAvailable: true,
    sourceIconDataByUrl: new Map([['/custom', 'data:image/png;base64,preview']]) })
  assert.match(html, /data-asset-icon-trigger/)
  assert.match(html, /src="data:image\/png;base64,preview"/)
  assert.match(html, /data-reset-asset-icon/)
  assert.ok(html.indexOf('asset-icon-control') < html.indexOf('asset-badge-row'))
  const reset = renderAssetDetailDrawer({ asset: { ...asset, customIconUrl: null, iconReset: true }, iconControlsAvailable: true })
  assert.match(reset, /data-change-asset-icon/)
  assert.match(reset, /data-reset-asset-icon disabled/)
  assert.match(reset, /Kembalikan ikon bawaan/)
  const imported = renderAssetDetailDrawer({ asset: { ...asset, customIconUrl: null, sourceIconUrl: '/source' }, iconControlsAvailable: true })
  assert.match(imported, /data-reset-asset-icon/)
  assert.doesNotMatch(imported, /data-reset-asset-icon disabled/)
  const defaultJunction = { id: 'jb', type: 'Junction box', sourceIconUrl: '/unused-source' }
  assert.equal(assetIconCanReset(defaultJunction), false)
  assert.equal(assetIconCanReset({ ...defaultJunction, customIconUrl: '/custom' }), true)
})

test('viewer detail displays the icon without any editing actions', () => {
  const asset = { id: 'cam', name: 'Kamera', type: 'CCTV', customIconUrl: '/custom' }
  const html = renderAssetDetailDrawer({ asset, iconControlsAvailable: isAdministrator({ role: 'Viewer' }),
    sourceIconDataByUrl: new Map([['/custom', 'data:image/png;base64,preview']]) })
  assert.match(html, /src="data:image\/png;base64,preview"/)
  assert.doesNotMatch(html, /data-asset-icon-trigger|data-change-asset-icon|data-reset-asset-icon/)
  assert.equal(isAdministrator(null), false)
  assert.equal(isAdministrator({ role: 'administrator' }), true)
})

test('current user refresh replaces a cached administrator role before controls render', async t => {
  const entries = new Map()
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true,
    json: async () => ({ user: { id: 'account', role: 'Viewer' } }) }))
  const previousWindow = globalThis.window
  globalThis.window = { sessionStorage: {
    getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value),
  } }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  saveSession({ token: 'session', user: { id: 'account', role: 'Administrator' } })
  assert.equal(isAdministrator(), true)
  await loadCurrentUser()
  assert.equal(getSessionUser().role, 'Viewer')
  assert.equal(isAdministrator(), false)
})

test('icon picker rejects unsupported and oversized uploads before decoding', () => {
  assert.throws(() => validateAssetIconFile({ type: 'image/svg+xml', size: 30 }))
  assert.throws(() => validateAssetIconFile({ type: 'image/png', size: 6 * 1024 * 1024 }))
  assert.doesNotThrow(() => validateAssetIconFile({ type: 'image/webp', size: 1000 }))
})
