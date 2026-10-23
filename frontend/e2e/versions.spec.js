import { test, expect } from './test.js'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'

const version = id => ({ id, name: id, created_at: '2026-10-23T00:00:00Z', actor_name: 'admin', summary: { assets: 2, relations: 1 } })
async function setup(page) {
  const state = { calls: [], data: { revision: 4, currentVersionId: 'B', versions: [version('B'), version('A')] }, listFailure: 0, writeFailure: 0, existing: false, gate: null, pendingRead: null }
  await page.addInitScript(user => {
    if (location.pathname.startsWith('/admin/datasets/versions')) {
      sessionStorage.setItem('sinergiSessionToken', 'versions-token')
      sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user))
    }
  }, fixtures.user)
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    state.calls.push({ path, method, body: request.postDataJSON(), token: request.headers().authorization })
    if (path.startsWith('/api/auth/')) return route.fulfill({ json: { user: fixtures.user } })
    if (path === '/api/import-config') return route.fulfill({ json: { datasets: [{ id: 'shared', name: 'Shared' }, { id: 'other', name: 'Other' }] } })
    if (path.endsWith('/versions') && method === 'GET') {
      if (path === '/api/datasets/shared/versions' && state.pendingRead) {
        const response = await state.pendingRead
        return route.fulfill({ json: response })
      }
      return route.fulfill({ status: state.listFailure || 200, json: state.listFailure ? { error: { message: 'Daftar versi gagal' } } : path.includes('/other/') ? { revision: 2, currentVersionId: null, versions: [version('Other version')] } : state.data })
    }
    if (path.startsWith('/api/datasets/') && method === 'POST') {
      if (state.gate) await state.gate
      if (state.writeFailure) return route.fulfill({ status: state.writeFailure, json: { error: { message: 'Data berubah; muat ulang.' } } })
      const restore = path.endsWith('/restore')
      state.data = { ...state.data, revision: 9, currentVersionId: restore ? 'A' : 'C', versions: restore ? state.data.versions : [{ ...version('C'), name: request.postDataJSON().name }, ...state.data.versions] }
      return route.fulfill({ json: restore ? { datasetId: 'shared', revision: 9, currentVersionId: 'A' } : { datasetId: 'shared', revision: 9, existing: state.existing, version: state.data.versions[0] } })
    }
    throw new Error(`Unmocked versions endpoint: ${method} ${path}`)
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin/datasets/versions?datasetId=shared&area=Semarang', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-version-state]')).toHaveText('Data aktif: “B”.')
  return { state, errors, writes: () => state.calls.filter(call => call.method === 'POST' && call.path.startsWith('/api/datasets/')) }
}
const save = page => page.locator('[data-save-version]')
async function openSave(page) { await save(page).click(); return page.getByRole('dialog') }

test('React versions preserve active checkpoint, dataset context and history separation', async ({ page }) => {
  const modules = []
  page.on('request', request => modules.push(request.url()))
  const { state, errors } = await setup(page)
  expect(modules.some(url => url.includes('/src/react/versions/VersionsPage.jsx'))).toBe(true)
  expect(modules.some(url => url.includes('/src/pages/admin/dataset-versions-page.js'))).toBe(false)
  await expect(page.getByLabel('Dataset aktif')).toHaveValue('shared')
  await expect(page.locator('[data-restore-version=B]')).toBeDisabled()
  await expect(page.locator('[data-restore-version=A]')).toBeEnabled()
  await expect(page.getByText('10 versi maksimum')).toBeVisible()
  expect(state.calls.some(call => call.path === '/api/imports')).toBe(false)
  await page.locator('[data-user-account-trigger]').click()
  await expect(page.getByRole('menuitem', { name: 'Versi database' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('menuitem', { name: 'Kelola pengguna' })).toHaveAttribute('href', '/admin/users?datasetId=shared&area=Semarang')
  expect(errors).toEqual([])
})

test('save validates and trims name, sends once, blocks dismissal and restores focus', async ({ page }) => {
  const { state, errors, writes } = await setup(page)
  const dialog = await openSave(page)
  await dialog.getByRole('button', { name: 'Simpan versi' }).click()
  expect(writes()).toHaveLength(0)
  await expect(page.getByLabel('Nama versi')).toBeFocused()
  await page.getByLabel('Nama versi').fill('   ')
  await dialog.getByRole('button', { name: 'Simpan versi' }).click()
  await expect(page.locator('[data-dialog-status]')).toHaveText('Isi nama versi terlebih dahulu.')
  await page.getByLabel('Nama versi').fill('  Seminar  ')
  let release
  state.gate = new Promise(resolve => { release = resolve })
  await dialog.getByRole('button', { name: 'Simpan versi' }).click()
  await page.locator('[data-version-form]').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await expect(page.getByLabel('Dataset aktif')).toBeDisabled()
  await expect(page.locator('[data-dialog-status]')).toHaveText('Menyimpan versi…')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect.poll(() => writes().length).toBe(1)
  expect(writes()[0].body).toEqual({ name: 'Seminar', expectedRevision: 4 })
  expect(writes()[0].token).toBe('Bearer versions-token')
  release()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-version-state]')).toHaveText('Data aktif: “Seminar”.')
  await expect(save(page)).toBeFocused()
  expect(await page.evaluate(() => localStorage.getItem('sinergi:revision:shared'))).toBe('9')
  expect(errors).toEqual([])
})

test('ordinary save failure keeps draft and original revision, retry recognizes an existing checkpoint', async ({ page }) => {
  const { state, errors, writes } = await setup(page)
  await page.evaluate(() => { window.versionsHeader = document.querySelector('header') })
  const dialog = await openSave(page)
  await page.getByLabel('Nama versi').fill('Keep draft')
  state.data.revision = 6
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  state.writeFailure = 500
  await dialog.getByRole('button', { name: 'Simpan versi' }).click()
  await expect(page.locator('[data-dialog-status]')).toHaveText('Data berubah; muat ulang.')
  await expect(page.getByLabel('Nama versi')).toHaveValue('Keep draft')
  expect(writes()[0].body.expectedRevision).toBe(4)
  state.writeFailure = 0; state.existing = true
  await dialog.getByRole('button', { name: 'Simpan versi' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-version-status]')).toHaveText('Keadaan ini sudah tersimpan sebagai “Keep draft”.')
  expect(writes()[1].body.expectedRevision).toBe(4)
  expect(await page.evaluate(() => window.versionsHeader === document.querySelector('header'))).toBe(true)
  expect(errors).toEqual([])
})

test('restore requires confirmation, freezes snapshot revision and updates the active checkpoint', async ({ page }) => {
  const { state, errors, writes } = await setup(page)
  const opener = page.locator('[data-restore-version=A]')
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Keadaan sekarang disimpan otomatis')
  await expect(dialog.getByRole('button', { name: 'Batal' })).toBeFocused()
  expect(writes()).toHaveLength(0)
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  await opener.click()
  state.data.revision = 6
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  let release
  state.gate = new Promise(resolve => { release = resolve })
  await dialog.getByRole('button', { name: 'Pulihkan', exact: true }).click()
  await expect(page.locator('[data-dialog-status]')).toHaveText('Memulihkan data…')
  await expect(page.getByLabel('Dataset aktif')).toBeDisabled()
  await expect.poll(() => writes().length).toBe(1)
  expect(writes()[0].path).toBe('/api/datasets/shared/versions/A/restore')
  expect(writes()[0].body).toEqual({ expectedRevision: 4 })
  release()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-version-state]')).toHaveText('Data aktif: “A”.')
  await expect(page.locator('[data-restore-version=A]')).toBeDisabled()
  await expect(save(page)).toBeFocused()
  expect(errors).toEqual([])
})

test('revision conflict closes the dialog and reopening uses a fresh revision', async ({ page }) => {
  const { state, errors, writes } = await setup(page)
  await openSave(page)
  await page.getByLabel('Nama versi').fill('Stale')
  state.writeFailure = 409; state.data.revision = 6
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan versi' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-version-status]')).toHaveText('Data berubah; muat ulang.')
  await openSave(page)
  await page.getByLabel('Nama versi').fill('Fresh')
  state.writeFailure = 0
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan versi' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes()[0].body.expectedRevision).toBe(4)
  expect(writes()[1].body.expectedRevision).toBe(6)
  expect(errors).toEqual([])
})

test('read failure disables stale actions and explicit retry handles an empty checkpoint list', async ({ page }) => {
  const { state, errors } = await setup(page)
  state.listFailure = 500
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('[data-version-state]')).toHaveText('Status versi belum diperbarui.')
  await expect(save(page)).toBeDisabled()
  await expect(page.locator('[data-restore-version=A]')).toBeDisabled()
  state.listFailure = 0; state.data = { revision: 6, currentVersionId: null, versions: [] }
  await page.getByRole('button', { name: 'Coba lagi' }).click()
  await expect(page.locator('[data-version-list]')).toContainText('Belum ada versi tersimpan.')
  await expect(save(page)).toBeEnabled()
  expect(errors).toEqual([])
})

test('switching dataset ignores a delayed response and listens only for the selected dataset revision', async ({ page }) => {
  const { state, errors } = await setup(page)
  let release
  state.pendingRead = new Promise(resolve => { release = resolve })
  const count = state.calls.filter(call => call.path === '/api/datasets/shared/versions').length
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => state.calls.filter(call => call.path === '/api/datasets/shared/versions').length).toBe(count + 1)
  await page.getByLabel('Dataset aktif').selectOption('other')
  await expect(page.getByRole('cell', { name: 'Other version' })).toBeVisible()
  release({ revision: 99, currentVersionId: null, versions: [version('STALE')] })
  await expect(page.getByText('STALE', { exact: true })).toHaveCount(0)
  const before = state.calls.length
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:shared', newValue: '99' })))
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'sinergi:revision:other', newValue: '99' })))
  await expect.poll(() => state.calls.length).toBe(before + 1)
  expect(new URL(page.url()).searchParams.get('datasetId')).toBe('shared')
  expect(errors).toEqual([])
})

test('leaving during a write ignores its result, revision storage and refresh listeners', async ({ page }) => {
  const { state, errors, writes } = await setup(page)
  let release
  state.gate = new Promise(resolve => { release = resolve })
  const readsBefore = state.calls.filter(call => call.path.endsWith('/versions') && call.method === 'GET').length
  await openSave(page)
  await page.getByLabel('Nama versi').fill('Leaving')
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan versi' }).click()
  await expect.poll(() => writes().length).toBe(1)
  await page.goto('/e2e/fixtures/react.html', { waitUntil: 'networkidle' })
  release()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(await page.evaluate(() => localStorage.getItem('sinergi:revision:shared'))).toBeNull()
  expect(state.calls.filter(call => call.path.endsWith('/versions') && call.method === 'GET')).toHaveLength(readsBefore)
  expect(errors).toEqual([])
})
