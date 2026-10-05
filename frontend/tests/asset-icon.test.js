import assert from 'node:assert/strict'
import test from 'node:test'
import { assetIconUrl, assetIconCanReset } from '../src/domain/asset-icon.js'
import { renderAssetDetailDrawer } from '../src/pages/map/asset-detail-drawer.js'
import { validateAssetIconFile, bindAssetIconControl } from '../src/pages/map/asset-icon-editor.js'
import { adaptActiveAssetDetail } from '../src/adapters/active-dataset-map-adapter.js'
import { isAdministrator, loadCurrentUser, getSessionUser, saveSession } from '../src/services/account-session.js'

test('custom icons take precedence for every asset type and reset suppresses imported icons', () => {
  const camera = { type: 'CCTV', sourceIconUrl: '/source', customIconUrl: '/custom' }
  assert.equal(assetIconUrl(camera), '/custom')
  assert.equal(assetIconUrl({ ...camera, type: 'Junction box' }), '/custom')
  const reset = { ...camera, customIconUrl: null, iconReset: true }
  assert.equal(assetIconUrl(reset), null)
  assert.equal(assetIconCanReset(reset), false)
  assert.equal(assetIconUrl({ ...reset, type: 'Junction box' }), null)
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
  assert.match(reset, /Hapus ikon/)
  assert.doesNotMatch(reset, /Kembalikan ikon bawaan/)
  const imported = renderAssetDetailDrawer({ asset: { ...asset, customIconUrl: null, sourceIconUrl: '/source' }, iconControlsAvailable: true })
  assert.match(imported, /data-reset-asset-icon/)
  assert.doesNotMatch(imported, /data-reset-asset-icon disabled/)
  const defaultJunction = { id: 'jb', type: 'Junction box', sourceIconUrl: '/unused-source' }
  assert.equal(assetIconCanReset(defaultJunction), true)
  assert.equal(assetIconCanReset({ ...defaultJunction, customIconUrl: '/custom' }), true)
  const deletedJunction = { ...defaultJunction, iconReset: true }
  assert.equal(assetIconCanReset(deletedJunction), false)
  const deletedHtml = renderAssetDetailDrawer({ asset: deletedJunction,
    connectedAssets: [{ asset: deletedJunction }],
    sourceIconDataByUrl: new Map([['/icons/junction-box.png', 'data:image/png;base64,old']]) })
  assert.doesNotMatch(deletedHtml, /junction-box\.png|data:image\/png;base64,old/)
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

test('replace opens the native picker immediately and saves the selected file without a dialog', async t => {
  const controls = iconControls(t)
  controls.replace.click()
  assert.equal(controls.inputs.length, 1)
  const input = controls.inputs[0]
  assert.equal(input.clickCount, 1)
  assert.equal(input.type, 'file')
  assert.equal(input.accept, 'image/png,image/jpeg,image/webp')
  assert.equal(controls.trigger.disabled, true)
  controls.replace.click()
  assert.equal(controls.inputs.length, 1)
  input.files = [{ name: 'camera.png', type: 'image/png', size: 100 }]
  input.dispatchEvent(new Event('change'))
  await tick()
  assert.deepEqual(controls.saved, ['data:image/png;base64,new'])
  assert.equal(input.removed, true)
  assert.equal(controls.feedback.textContent, 'Ikon diperbarui.')
  assert.equal(controls.trigger.disabled, false)
})

test('canceling the native picker leaves the current icon untouched', async t => {
  const controls = iconControls(t)
  controls.replace.click()
  controls.inputs[0].dispatchEvent(new Event('cancel'))
  await tick()
  assert.deepEqual(controls.saved, [])
  assert.equal(controls.inputs[0].removed, true)
  assert.equal(controls.trigger.disabled, false)
  assert.equal(controls.feedback.hidden, true)
})

test('invalid files report an inline error without changing the icon and allow a retry', async t => {
  const controls = iconControls(t)
  controls.replace.click()
  controls.inputs[0].files = [{ type: 'image/svg+xml', size: 100 }]
  controls.inputs[0].dispatchEvent(new Event('change'))
  await tick()
  assert.deepEqual(controls.saved, [])
  assert.equal(controls.feedback.attributes.role, 'alert')
  assert.equal(controls.trigger.disabled, false)
  controls.replace.click()
  controls.inputs[1].files = [{ type: 'image/png', size: 100 }]
  controls.inputs[1].dispatchEvent(new Event('change'))
  await tick()
  assert.equal(controls.saved.length, 1)
})

test('delete sends the icon deletion directly and never opens a file picker', async t => {
  const controls = iconControls(t)
  controls.remove.click()
  await tick()
  assert.deepEqual(controls.saved, [null])
  assert.equal(controls.inputs.length, 0)
  assert.equal(controls.feedback.textContent, 'Ikon dihapus.')
})

test('a drawer refresh during file selection still saves to the original asset callback', async t => {
  const controls = iconControls(t)
  controls.replace.click()
  controls.cleanup()
  controls.inputs[0].files = [{ type: 'image/png', size: 100 }]
  controls.inputs[0].dispatchEvent(new Event('change'))
  await tick()
  assert.deepEqual(controls.saved, ['data:image/png;base64,new'])
  assert.equal(controls.inputs[0].removed, true)
})

function iconControls(t) {
  class Element extends EventTarget {
    disabled = false
    hidden = true
    attributes = {}
    clickCount = 0
    classList = { toggle() {} }
    click() { this.clickCount++; this.dispatchEvent(new Event('click')) }
    focus() {}
    contains() { return true }
    remove() { this.removed = true }
    setAttribute(key, value) { this.attributes[key] = value }
  }
  const trigger = new Element()
  const menu = new Element()
  const control = new Element()
  const replace = new Element()
  const remove = new Element()
  const feedback = new Element()
  menu.querySelector = () => replace
  const elements = { '[data-asset-icon-trigger]': trigger, '#asset-icon-actions': menu,
    '.asset-icon-control': control, '[data-change-asset-icon]': replace,
    '[data-reset-asset-icon]': remove, '[data-asset-icon-feedback]': feedback }
  const inputs = []
  const previous = globalThis.document
  globalThis.document = Object.assign(new EventTarget(), {
    body: { append(input) { inputs.push(input) } },
    createElement(tag) { assert.equal(tag, 'input'); return new Element() },
  })
  const saved = []
  const cleanup = bindAssetIconControl({ querySelector: selector => elements[selector] }, {
    prepareIcon: async file => { validateAssetIconFile(file); return 'data:image/png;base64,new' },
    onSave: async dataUrl => { saved.push(dataUrl) },
  })
  t.after(() => {
    cleanup()
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  })
  return { trigger, replace, remove, feedback, inputs, saved, cleanup }
}

const tick = () => new Promise(resolve => setImmediate(resolve))
