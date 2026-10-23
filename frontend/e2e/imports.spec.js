import { test, expect } from './test.js'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
const row = (id, status = 'ready') => ({ id, name: id, dataset_id: 'shared', source_filename: `${id}.kmz`, created_at: '2026-10-23T00:00:00Z', status, summary: { addedAssets: 2, addedRelations: 1 } })
async function setup(page, role = 'Administrator') {
  const state = { calls: [], uploadFailure: 0, gate: null, process: 'processing', listFailure: 0 }
  await page.addInitScript(user => { sessionStorage.setItem('sinergiSessionToken', 'imports-token'); sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user)) }, { ...fixtures.user, role })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    state.calls.push({ path, method, body: request.postDataBuffer()?.toString(), token: request.headers().authorization })
    if (path.startsWith('/api/auth/')) return route.fulfill({ json: { user: { ...fixtures.user, role } } })
    if (path === '/api/import-config') return route.fulfill({ json: { datasets: [{ id: 'shared' }, { id: 'other' }], maxFileSize: 100 } })
    if (path === '/api/imports' && method === 'GET') return route.fulfill({ status: state.listFailure || 200, json: state.listFailure ? { error: { message: 'Riwayat gagal' } } : { imports: [row('Seminar'), { ...row('Archive', 'applied'), included_in_active: false }, { ...row('Other'), dataset_id: 'other' }] } })
    if (path.endsWith('/source-file')) return route.fulfill({ body: '<kml/>', headers: { 'content-disposition': "attachment; filename*=UTF-8''Peta%20sumber.kmz" } })
    if (path === '/api/imports' && method === 'POST') {
      if (state.gate) await state.gate
      return route.fulfill({ status: state.uploadFailure || 202, json: state.uploadFailure ? { error: { message: 'Unggah gagal' } } : { importId: 'returned-id', statusUrl: '/api/jobs/different-id' } })
    }
    if (path === '/api/jobs/different-id') return route.fulfill({ json: { import: { status: state.process, error: { message: 'Pemrosesan gagal' } } } })
    // Viewer redirect and legacy preview are outside this stage: prevent operational requests.
    return route.fulfill({ status: 404, json: { error: { message: 'Mock endpoint' } } })
  })
  await page.goto('/admin/datasets/import?datasetId=shared', { waitUntil: 'networkidle' })
  return state
}
async function fill(page) {
  await page.getByRole('button', { name: 'Impor KML/KMZ' }).click()
  await page.getByLabel('Nama impor').fill('  Seminar  ')
  await page.getByLabel('File KML/KMZ').setInputFiles({ name: 'Peta.KMZ', mimeType: 'application/octet-stream', buffer: Buffer.from('<kml/>') })
}
const submit = page => page.getByRole('button', { name: 'Unggah dan lihat preview' })
test('imports route uses React, filters dataset/search/status and keeps preview as document link', async ({ page }) => {
  const modules = []; page.on('request', request => modules.push(request.url()))
  await setup(page)
  expect(modules.some(url => url.includes('/react/imports/ImportsPage.jsx'))).toBe(true)
  expect(modules.some(url => url.includes('/pages/admin/import-dataset-page.js'))).toBe(false)
  await expect(page.getByText('Pernah diterapkan · di luar data aktif')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/admin/datasets/import/Seminar/preview')
  await page.getByLabel('Cari riwayat impor').fill('seminar.kmz')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByLabel('Filter status impor').selectOption('failed')
  await expect(page.getByText('Tidak ada impor yang sesuai.')).toBeVisible()
  await page.getByLabel('Cari riwayat impor').clear(); await page.getByLabel('Filter status impor').selectOption('')
  await page.getByLabel('Dataset aktif').selectOption('other')
  await expect(page.locator('tbody tr')).toHaveCount(1); await expect(page.locator('tbody strong')).toHaveText('Other')
})
test('failed upload preserves file and draft, busy blocks repeat and Escape, discard restores focus', async ({ page }) => {
  const state = await setup(page); await fill(page)
  let release; state.gate = new Promise(resolve => { release = resolve }); state.uploadFailure = 500
  await submit(page).click()
  await page.locator('[data-import-form]').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await expect(page.getByLabel('Nama impor')).toBeDisabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => state.calls.filter(call => call.method === 'POST' && call.path === '/api/imports').length).toBe(1)
  const call = state.calls.find(call => call.method === 'POST' && call.path === '/api/imports')
  expect(call.token).toBe('Bearer imports-token'); expect(call.body).toContain('  Seminar  '); expect(call.body).toContain('Peta.KMZ'); expect(call.body).toContain('shared')
  release(); await expect(page.locator('[data-upload-status]')).toHaveText('Unggah gagal')
  await expect(page.getByLabel('Nama impor')).toHaveValue('  Seminar  ')
  expect(await page.getByLabel('File KML/KMZ').evaluate(input => input.files[0].name)).toBe('Peta.KMZ')
  await page.keyboard.press('Escape'); await expect(page.getByText('Buang draft impor?')).toBeVisible()
  await page.getByRole('button', { name: 'Lanjutkan mengisi' }).click(); await expect(page.getByLabel('Nama impor')).toBeFocused()
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Buang draft', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('[data-open-import]')).toBeFocused()
})
test('polls processing then navigates to preview ID from upload response', async ({ page }) => {
  const state = await setup(page); await fill(page)
  await page.route('**/admin/datasets/import/returned-id/preview', route => route.fulfill({ contentType: 'text/html', body: '<h1>Mock preview</h1>' }))
  await submit(page).click(); await expect(page.locator('[data-upload-status]')).toHaveText('Membaca aset dan mencari tambahan…')
  state.process = 'ready'; await expect(page).toHaveURL(/\/returned-id\/preview$/)
  await expect(page.getByRole('heading', { name: 'Mock preview' })).toBeVisible()
  expect(state.calls.some(call => call.path === '/api/jobs/different-id')).toBe(true)
})
test('downloads authenticated source preserving encoded filename', async ({ page }) => {
  const state = await setup(page), downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'File sumber' }).first().click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('Peta sumber.kmz')
  expect(state.calls.find(call => call.path.endsWith('/source-file')).token).toBe('Bearer imports-token')
})
test('Viewer cannot access import management', async ({ page }) => {
  const state = await setup(page, 'Viewer')
  await expect(page).toHaveURL(/\/map$/)
  expect(state.calls.some(call => call.path === '/api/imports')).toBe(false)
})
