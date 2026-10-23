import { test, expect } from './test.js'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'

async function setup(page) {
  const state = { users: [fixtures.user, { ...fixtures.viewer, email: 'viewer@example.test' }], calls: [], failure: 0, listFailure: 0, gate: null, revokeSelf: false }
  await page.addInitScript(user => {
    if (location.pathname.startsWith('/admin/users')) {
      sessionStorage.setItem('sinergiSessionToken', 'users-test-token')
      sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user))
    }
  }, fixtures.user)
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    state.calls.push({ path, method: request.method(), body: request.postDataJSON(), token: request.headers().authorization })
    if (path === '/api/auth/me' || path === '/api/auth/heartbeat') return route.fulfill({ json: { user: fixtures.user } })
    if (path === '/api/admin/users' && request.method() === 'GET') return route.fulfill({ status: state.listFailure || 200, json: state.listFailure ? { error: { message: 'Koneksi daftar gagal' } } : { users: state.users, serverTime: '2026-10-23T00:00:00Z' } })
    if (path.startsWith('/api/admin/users')) {
      if (state.gate) await state.gate
      if (state.failure) return route.fulfill({ status: state.failure, json: { error: { message: 'Data pengguna sudah berubah' } } })
      const user = state.revokeSelf ? fixtures.user : state.users[1]
      return route.fulfill({ json: { user, sessionsRevoked: true } })
    }
    throw new Error(`Unmocked users endpoint: ${request.method()} ${path}`)
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin/users?datasetId=dataset-semarang&area=Semarang', { waitUntil: 'networkidle' })
  await expect(page.getByText('viewer@example.test')).toBeVisible()
  return { state, errors, writes: () => state.calls.filter(call => call.path.startsWith('/api/admin/users') && call.method !== 'GET') }
}
async function editViewer(page) { await page.getByRole('row').filter({ hasText: 'viewer@example.test' }).getByRole('button', { name: 'Kelola' }).click() }

test('users route uses React, preserves document navigation and filters by email and role', async ({ page }) => {
  const modules = []
  page.on('request', request => modules.push(request.url()))
  const { errors } = await setup(page)
  expect(modules.some(url => url.includes('/src/react/users/UsersPage.jsx'))).toBe(true)
  expect(modules.some(url => url.includes('/src/pages/admin/users-page.js'))).toBe(false)
  await page.getByLabel('Cari pengguna').fill('EXAMPLE.TEST')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByLabel('Filter peran').selectOption('Administrator')
  await expect(page.locator('tbody')).toContainText('Tidak ada pengguna yang sesuai.')
  await page.getByLabel('Cari pengguna').clear()
  await page.getByLabel('Filter peran').selectOption('')
  await page.locator('[data-user-account-trigger]').click()
  await expect(page.getByRole('menuitem', { name: 'Versi database' })).toHaveAttribute('href', '/admin/datasets/versions?datasetId=dataset-semarang&area=Semarang')
  expect(errors).toEqual([])
})

test('create respects browser validation, prevents repeated writes and restores focus', async ({ page }) => {
  const { state, writes, errors } = await setup(page)
  const opener = page.getByRole('button', { name: 'Tambah pengguna', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Tambah pengguna', exact: true }).click()
  expect(writes()).toHaveLength(0)
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused()
  await page.getByLabel('Username', { exact: true }).fill('new-user')
  await page.getByLabel('Email (opsional)').fill('new@example.test')
  await page.getByLabel('Password awal').fill('password123')
  let release
  state.gate = new Promise(resolve => { release = resolve })
  await dialog.getByRole('button', { name: 'Tambah pengguna', exact: true }).click()
  await page.locator('[data-user-form]').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect.poll(() => writes().length).toBe(1)
  expect(writes()[0].body).toEqual({ username: 'new-user', email: 'new@example.test', role: 'Viewer', password: 'password123' })
  expect(writes()[0].token).toBe('Bearer users-test-token')
  release()
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Data pengguna tersimpan.')
  expect(errors).toEqual([])
})

test('conflict preserves edit draft and original revision through a background refresh', async ({ page }) => {
  const { state, writes, errors } = await setup(page)
  await editViewer(page)
  await page.getByLabel('Email (opsional)').fill('draft@example.test')
  state.users[1] = { ...state.users[1], updatedAt: 'changed-elsewhere' }
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  state.failure = 409
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('alert')).toHaveText('Data pengguna sudah berubah')
  await expect(page.getByLabel('Email (opsional)')).toHaveValue('draft@example.test')
  expect(writes()[0].body.expectedUpdatedAt).toBe(fixtures.viewer.updatedAt)
  state.failure = 0
  await page.getByRole('button', { name: 'Simpan perubahan' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes()[1].body.expectedUpdatedAt).toBe(fixtures.viewer.updatedAt)
  expect(errors).toEqual([])
})

test('drawer protects draft and focus, confirms reset switch and resets another user session', async ({ page }) => {
  const { writes, errors } = await setup(page)
  await editViewer(page)
  await page.getByLabel('Email (opsional)').fill('draft@example.test')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Buang perubahan?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lanjutkan mengedit' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Email (opsional)')).toHaveValue('draft@example.test')
  await page.getByRole('button', { name: 'Reset password' }).click()
  await page.getByRole('button', { name: 'Buang perubahan' }).click()
  await expect(page.getByLabel('Password baru')).toBeFocused()
  await page.getByLabel('Password baru').fill('new-password')
  await page.getByRole('button', { name: 'Ubah password' }).click()
  await expect(page.getByRole('status')).toHaveText('Password diubah dan sesi pengguna diakhiri.')
  expect(writes()[0].path).toBe(`/api/admin/users/${fixtures.viewer.id}/password`)
  expect(writes()[0].body).toEqual({ password: 'new-password', expectedUpdatedAt: fixtures.viewer.updatedAt })
  expect(new URL(page.url()).pathname).toBe('/admin/users')
  expect(errors).toEqual([])
})

test('last administrator cannot be demoted and self revocation returns to login', async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.getByRole('row').filter({ hasText: fixtures.user.username }).getByRole('button', { name: 'Kelola' }).click()
  await expect(page.getByRole('combobox', { name: 'Peran', exact: true })).toBeDisabled()
  await expect(page.getByText('Administrator terakhir harus tetap tersedia.')).toBeVisible()
  await page.getByRole('button', { name: 'Reset password' }).click()
  await page.getByLabel('Password baru').fill('new-password')
  state.revokeSelf = true
  await page.getByRole('button', { name: 'Ubah password' }).click()
  await expect(page.locator('#login-form')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('sinergiSessionToken'))).toBeNull()
  expect(errors).toEqual([])
})

test('failed polling retains rows with unconfirmed status, retries and handles empty data', async ({ page }) => {
  const { state, errors } = await setup(page)
  state.listFailure = 500
  await page.getByRole('button', { name: 'Muat ulang' }).click()
  await expect(page.getByRole('alert')).toContainText('Koneksi daftar gagal')
  await expect(page.getByText('Belum diperbarui', { exact: true })).toHaveCount(2)
  await expect(page.getByText('Online', { exact: true })).toHaveCount(0)
  await expect(page.getByText('viewer@example.test')).toBeVisible()
  state.listFailure = 0; state.users = []
  await page.getByRole('button', { name: 'Muat ulang' }).click()
  await expect(page.locator('tbody')).toHaveText('Tidak ada pengguna yang sesuai.')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('draft warns before a document navigation and polling stops when the document leaves', async ({ page }) => {
  const { state, errors } = await setup(page)
  await page.clock.install()
  await editViewer(page)
  await page.getByLabel('Email (opsional)').fill('unsaved@example.test')
  const dialog = page.waitForEvent('dialog')
  const navigation = page.goto('/').catch(() => {})
  const warning = await dialog
  expect(warning.type()).toBe('beforeunload')
  await warning.dismiss()
  await navigation
  await expect(page.getByLabel('Email (opsional)')).toHaveValue('unsaved@example.test')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Buang perubahan' }).click()
  await page.goto('/e2e/fixtures/react.html')
  const count = state.calls.filter(call => call.path === '/api/admin/users').length
  await page.clock.fastForward(60_000)
  expect(state.calls.filter(call => call.path === '/api/admin/users')).toHaveLength(count)
  expect(errors).toEqual([])
})
