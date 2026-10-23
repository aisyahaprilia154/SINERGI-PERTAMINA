import { test, expect } from '@playwright/test'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'

async function installApi(page, { role = 'Administrator', authenticated = false } = {}) {
  const user = role === 'Viewer' ? fixtures.viewer : fixtures.user
  const state = { authenticated, calls: [], loginFailure: null, loginGate: null, expireHeartbeat: false }
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname
    state.calls.push({ pathname, method: request.method(), token: request.headers().authorization, body: request.postDataJSON(), pagePath: new URL(page.url()).pathname })
    if (pathname === '/api/auth/login') {
      if (state.loginGate) await state.loginGate
      if (state.loginFailure === 'network') return route.abort('failed')
      if (state.loginFailure) return route.fulfill({ status: 401, json: { error: { message: 'Kredensial tidak cocok' } } })
      state.authenticated = true
      return route.fulfill({ json: { token: 'browser-auth-token', user } })
    }
    if (pathname === '/api/auth/logout') { state.authenticated = false; return route.fulfill({ json: {} }) }
    if (pathname === '/api/auth/me' || pathname === '/api/auth/heartbeat') {
      if (state.expireHeartbeat && pathname.endsWith('heartbeat')) state.authenticated = false
      return route.fulfill({ status: state.authenticated ? 200 : 401, json: state.authenticated ? { user } : { error: { message: 'Sesi berakhir' } } })
    }
    let data
    if (pathname === '/api/admin/users') data = { users: [fixtures.user, fixtures.viewer], serverTime: '2026-10-23T00:00:00Z' }
    else if (pathname === '/api/import-config') data = { datasets: [{ id: 'dataset-semarang', name: 'SINERGI' }], maxFileSize: 60 * 1024 * 1024 }
    else if (pathname === '/api/imports') data = { imports: [fixtures.imported] }
    else if (pathname.endsWith('/preview')) data = fixtures.preview
    else if (pathname.endsWith('/versions')) data = { revision: 4, currentVersionId: null, versions: [] }
    else if (pathname.endsWith('/active')) data = fixtures.active
    else if (pathname.endsWith('/topology/graph')) data = { nodes: [], edges: [] }
    else if (pathname.endsWith('/overlays')) data = { overlays: [] }
    else if (pathname.endsWith('/planet')) data = fixtures.basemap
    else if (pathname.includes('/fonts/')) return route.fulfill({ status: 200, body: Buffer.alloc(0) })
    else throw new Error(`Unmocked request: ${request.method()} ${pathname}`)
    return route.fulfill({ json: data })
  })
  return state
}

async function seedSession(page, user = fixtures.user) {
  await page.evaluate(user => {
    sessionStorage.setItem('sinergiSessionToken', 'seed-token')
    sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user))
  }, user)
}

test('login success preserves session keys and enters the legacy map through a new document', async ({ page }) => {
  const state = await installApi(page)
  await page.goto('/')
  await page.evaluate(() => { window.loginDocumentMarker = true })
  await page.getByLabel('Email atau username').fill('  admin  ')
  await page.getByLabel('Kata sandi', { exact: true }).fill('secret')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  expect(await page.evaluate(() => window.loginDocumentMarker)).toBeUndefined()
  expect(await page.evaluate(() => sessionStorage.getItem('sinergiSessionToken'))).toBe('browser-auth-token')
  expect(state.calls.filter(call => call.pathname === '/api/auth/login')).toHaveLength(1)
  expect(state.calls.find(call => call.pathname === '/api/auth/login').body).toEqual({ identifier: 'admin', password: 'secret' })
  await expect.poll(() => state.calls.filter(call => call.pathname === '/api/auth/heartbeat').length).toBe(1)
  expect(state.calls.filter(call => call.pathname === '/api/auth/heartbeat').every(call => call.pagePath === '/map')).toBe(true)
})

test('failed and offline login retain draft, restore focus and allow retry', async ({ page }) => {
  const state = await installApi(page)
  state.loginFailure = 'credentials'
  await page.goto('/')
  await page.getByLabel('Email atau username').fill('viewer')
  await page.getByLabel('Kata sandi', { exact: true }).fill('secret')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Kredensial tidak cocok')
  await expect(page.getByLabel('Kata sandi', { exact: true })).toBeFocused()
  state.loginFailure = 'network'
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('alert')).not.toBeEmpty()
  await expect(page.getByLabel('Email atau username')).toHaveValue('viewer')
  await expect(page.getByLabel('Kata sandi', { exact: true })).toHaveValue('secret')
  state.loginFailure = null
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
})

test('pending login blocks repeated submit until the response arrives', async ({ page }) => {
  const state = await installApi(page)
  let release
  state.loginGate = new Promise(resolve => { release = resolve })
  await page.goto('/')
  await page.getByLabel('Email atau username').fill('admin')
  await page.getByLabel('Kata sandi', { exact: true }).fill('secret')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Memeriksa…' })).toBeDisabled()
  await page.locator('#login-form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(state.calls.filter(call => call.pathname === '/api/auth/login')).toHaveLength(1)
  release()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
})

test('existing sessions redirect from React login and logout returns to React login', async ({ page }) => {
  const state = await installApi(page, { authenticated: true })
  await page.goto('/')
  await seedSession(page)
  await page.reload()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await page.locator('[data-user-account-trigger]').click()
  await page.locator('[data-user-account-logout]').click()
  await expect(page.locator('#login-form')).toBeVisible()
  expect(state.calls.find(call => call.pathname === '/api/auth/logout').token).toBe('Bearer seed-token')
  expect(await page.evaluate(() => sessionStorage.getItem('sinergiSessionToken'))).toBeNull()
  expect(await page.evaluate(() => sessionStorage.getItem('sinergiSessionUser'))).toBeNull()
})

test('anonymous and expired sessions reach React login from protected routes', async ({ page }) => {
  await installApi(page)
  await page.goto('/admin/users')
  await expect(page.locator('#login-form')).toBeVisible()
  await seedSession(page)
  await page.goto('/map')
  await expect(page.locator('#login-form')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('sinergiSessionToken'))).toBeNull()
})

test('Viewer cannot enter any administrator route', async ({ page }) => {
  await installApi(page, { role: 'Viewer', authenticated: true })
  await page.goto('/')
  await seedSession(page, fixtures.viewer)
  for (const path of ['/admin/users', '/admin/datasets/versions', '/admin/datasets/import', '/admin/datasets/import/baseline-import/preview']) {
    await page.goto(path)
    await expect(page.locator('.maplibregl-canvas')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/map')
    await expect(page.locator('.user-menu-dropdown a[href^="/admin/"]')).toHaveCount(0)
  }
})

test('Administrator still enters the legacy user management page', async ({ page }) => {
  await installApi(page, { authenticated: true })
  await page.goto('/')
  await seedSession(page)
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Kelola pengguna' })).toBeVisible()
  await expect(page.locator('[data-new-user]')).toBeVisible()
})

test('one heartbeat per interval and an expired heartbeat returns to React login', async ({ page }) => {
  const state = await installApi(page, { authenticated: true })
  await page.goto('/')
  await seedSession(page)
  await page.clock.install()
  await page.goto('/map')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  const heartbeats = () => state.calls.filter(call => call.pathname === '/api/auth/heartbeat')
  await expect.poll(() => heartbeats().length).toBe(1)
  state.expireHeartbeat = true
  await page.clock.fastForward(30_000)
  await expect(page.locator('#login-form')).toBeVisible()
  expect(heartbeats()).toHaveLength(2)
  expect(await page.evaluate(() => sessionStorage.getItem('sinergiSessionToken'))).toBeNull()
  await page.clock.fastForward(60_000)
  expect(heartbeats()).toHaveLength(2)
})

test('unknown URLs retain the public login fallback and query parameters', async ({ page }) => {
  await page.goto('/unknown?datasetId=preserved&area=Site+A')
  await expect(page.locator('#login-form')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('datasetId')).toBe('preserved')
  expect(new URL(page.url()).searchParams.get('area')).toBe('Site A')
})
