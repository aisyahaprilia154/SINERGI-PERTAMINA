import { test, expect } from './test.js'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
async function setup(page, { conflict = false, role = 'Administrator' } = {}) {
  const state = { calls: [], preview: structuredClone(fixtures.preview), failure: 0, pending: null, status: 'ready' }
  if (conflict) { state.preview.summary.conflicts = 1; state.preview.conflicts = [{ id: 'identity', kind: 'asset', status: 'conflict', reason: 'identity_conflict', proposal: { name: 'Ambiguous' }, result: { candidates: ['camera'] } }] }
  await page.addInitScript(user => { sessionStorage.setItem('sinergiSessionToken', 'preview-token'); sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user)) }, { ...fixtures.user, role })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    state.calls.push({ path, method, body: request.postDataJSON(), token: request.headers().authorization })
    if (path.startsWith('/api/auth/')) return route.fulfill({ json: { user: { ...fixtures.user, role } } })
    if (path.endsWith('/preview')) return route.fulfill({ json: state.preview })
    if (path.endsWith('/active')) return route.fulfill({ json: fixtures.active })
    if (path.endsWith('/source-file')) return route.fulfill({ body: '<kml/>', headers: { 'content-disposition': 'attachment; filename="preview.kml"' } })
    if (path.endsWith('/planet')) return route.fulfill({ json: fixtures.basemap })
    if (method === 'POST' || method === 'PATCH') {
      if (state.pending) await state.pending
      return route.fulfill({ status: state.failure || 200, json: state.failure ? { error: { message: 'Revision berubah' } } : { revision: 5 } })
    }
    if (path === '/api/imports/test') return route.fulfill({ json: { import: { status: state.status } } })
    if (path.includes('/fonts/')) return route.fulfill({ body: Buffer.alloc(0) })
    return route.fulfill({ status: 404, json: {} })
  })
  await page.goto('/admin/datasets/import/test/preview', { waitUntil: 'networkidle' })
  return { state, errors }
}
test('preview uses React and MapLibre, context toggle preserves a usable map, source download works', async ({ page }) => {
  const modules = []; page.on('request', request => modules.push(request.url()))
  const { errors } = await setup(page)
  await expect(page.getByRole('button', { name: 'Terapkan tambahan' })).toBeEnabled()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  expect(modules.some(url => url.includes('/react/preview/PreviewPage.jsx'))).toBe(true)
  expect(modules.some(url => url.includes('/pages/admin/preview-import-page.js'))).toBe(false)
  await page.getByLabel('Tampilkan aset lama').uncheck(); await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Unduh sumber' }).click()
  expect((await promise).suggestedFilename()).toBe('preview.kml'); expect(errors).toEqual([])
})
test('conflict draft survives failure and busy rejects duplicate decisions', async ({ page }) => {
  const { state, errors } = await setup(page, { conflict: true })
  await expect(page.locator('[data-apply]')).toBeDisabled()
  await page.getByRole('combobox', { name: /^Aset lama/ }).selectOption('camera')
  state.failure = 500; let release; state.pending = new Promise(resolve => { release = resolve })
  await page.getByRole('button', { name: 'Cocokkan ke aset lama' }).click()
  await expect(page.getByRole('combobox', { name: /^Aset lama/ })).toBeDisabled()
  await expect.poll(() => state.calls.filter(call => call.method === 'PATCH').length).toBe(1)
  const write = state.calls.find(call => call.method === 'PATCH')
  expect(write.body).toEqual({ decision: 'match_existing', assetId: 'camera' }); expect(write.token).toBe('Bearer preview-token')
  release(); await expect(page.getByRole('alert')).toHaveText('Revision berubah')
  await expect(page.getByRole('combobox', { name: /^Aset lama/ })).toHaveValue('camera'); expect(errors).toEqual([])
})
test('recalculation polls, apply sends base revision and enters the map within the SPA', async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.getByRole('button', { name: 'Hitung ulang preview' }).click()
  await expect(page.locator('[data-preview-status]')).toBeEmpty()
  expect(state.calls.some(call => call.path === '/api/imports/test' && call.method === 'GET')).toBe(true)
  await page.evaluate(()=>window.previewDocument='same-preview-document')
  await page.getByRole('button', { name: 'Terapkan tambahan' }).click()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect.poll(()=>new URL(page.url()).pathname).toBe('/map')
  expect(new URL(page.url()).searchParams.get('datasetId')).toBe('dataset-semarang')
  expect(await page.evaluate(()=>window.previewDocument)).toBe('same-preview-document')
  expect(state.calls.find(call => call.path.endsWith('/apply')).body).toEqual({ expectedRevision: 4 }); expect(errors).toEqual([])
})
test('Viewer is redirected before preview is loaded', async ({ page }) => {
  const { state } = await setup(page, { role: 'Viewer' })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/map')
  expect(state.calls.some(call => call.path.endsWith('/preview'))).toBe(false)
})
