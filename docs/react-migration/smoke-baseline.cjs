// Read-only baseline UI checks. Every API request is fulfilled locally.
const { chromium, expect } = require('playwright/test')
const fs = require('node:fs/promises')
const path = require('node:path')
const { user, viewer, active, preview, imported, basemap } = require('./capture-baseline.cjs')

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.BASELINE_BROWSER_CHANNEL || 'msedge' })
  const checks = [], errors = [], unexpected = []
  let context
  async function open(url, role = 'Administrator', mode = 'normal') {
    if (context) await context.close()
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
    const current = role === 'Viewer' ? viewer : user
    await context.addInitScript(({ current, role }) => {
      localStorage.setItem('sinergi.theme', 'light')
      if (role !== 'anonymous') {
        sessionStorage.setItem('sinergiSessionToken', 'mock-token')
        sessionStorage.setItem('sinergiSessionUser', JSON.stringify(current))
      }
    }, { current, role })
    const state = { mode, writes: 0 }
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/api/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname
      if (req.method() !== 'GET' && p !== '/api/auth/heartbeat' && p !== '/api/auth/login') {
        state.writes++; unexpected.push(`${req.method()} ${p}`)
        return route.fulfill({ status: 501, json: { error: { message: 'Write blocked by baseline mock' } } })
      }
      if (p === '/api/auth/login') return route.fulfill({ status: 401, json: { error: { message: 'Kredensial baseline tidak valid' } } })
      if (p === '/api/auth/me' && state.mode === 'expired') return route.fulfill({ status: 401, json: { error: { message: 'Sesi berakhir' } } })
      if (state.mode === 'error' && !p.startsWith('/api/auth/')) return route.fulfill({ status: 503, json: { error: { message: 'Baseline API offline' } } })
      let data
      if (p === '/api/auth/me' || p === '/api/auth/heartbeat') data = { user: current }
      else if (p === '/api/admin/users') data = { users: state.mode === 'empty' ? [] : [user, viewer], serverTime: '2026-10-23T00:00:00Z' }
      else if (p === '/api/import-config') data = { datasets: [{ id: 'dataset-semarang', name: 'SINERGI' }], maxFileSize: 60 * 1024 * 1024 }
      else if (p === '/api/imports') data = { imports: state.mode === 'empty' ? [] : [imported] }
      else if (p.endsWith('/preview')) data = preview
      else if (p.endsWith('/versions')) data = { revision: 4, currentVersionId: null, versions: [] }
      else if (p.endsWith('/active')) data = active
      else if (p.endsWith('/overlays')) data = { overlays: [] }
      else if (p.endsWith('/topology/graph')) data = { nodes: [], edges: [] }
      else if (p.endsWith('/planet')) data = basemap
      else if (p.includes('/fonts/')) return route.fulfill({ status: 200, body: Buffer.alloc(0) })
      else { unexpected.push(`${req.method()} ${p}`); return route.fulfill({ status: 501, json: {} }) }
      await route.fulfill({ status: 200, json: data })
    })
    await page.goto(`http://127.0.0.1:5173${url}`, { waitUntil: 'networkidle' })
    return { page, state }
  }
  function passed(name) { checks.push(name); console.log(`PASS ${name}`) }
  try {
    let { page } = await open('/', 'anonymous')
    await page.locator('#password').fill('example-password')
    await page.locator('.password-toggle').click()
    await expect(page.locator('#password')).toHaveAttribute('type', 'text')
    await page.locator('.password-toggle').click()
    await expect(page.locator('#password')).toHaveAttribute('type', 'password')
    await page.locator('#email').fill('baseline')
    await page.locator('[type=submit]').click()
    await expect(page.locator('.login-error')).toHaveText('Kredensial baseline tidak valid')
    await expect(page.locator('[type=submit]')).toBeEnabled()
    passed('Login toggle password, rejected login and retry control')

    ;({ page } = await open('/admin/users'))
    await page.locator('[data-search]').fill('no-matching-user')
    await expect(page.locator('.au-table-wrap tbody')).toContainText('Tidak ada pengguna')
    await page.locator('[data-search]').fill('')
    await page.locator('[data-role]').selectOption('Viewer')
    await expect(page.locator('.au-table-wrap tbody tr')).toHaveCount(1)
    await page.locator('[data-new-user]').click()
    await page.locator('input[name=username]').fill('unsaved-draft')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-discard-confirm]')).toBeVisible()
    await page.locator('[data-cancel-discard]').click()
    await expect(page.locator('input[name=username]')).toHaveValue('unsaved-draft')
    passed('User search, role filter and protected drawer draft')

    ;({ page } = await open('/admin/datasets/versions'))
    await expect(page.locator('[data-version-list]')).toContainText('Belum ada versi')
    await page.locator('[data-save-version]').click()
    await expect(page.locator('[role=dialog]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role=dialog]')).toHaveCount(0)
    await expect(page.locator('[data-save-version]')).toBeFocused()
    passed('Empty versions, save dialog Escape and focus restoration')

    ;({ page } = await open('/admin/datasets/import'))
    await page.locator('[data-open-import]').click()
    await page.locator('input[name=versionName]').fill('Baseline invalid file')
    await page.locator('input[type=file]').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') })
    await page.locator('[data-import-form] [type=submit]').click()
    await expect(page.locator('[data-upload-status]')).toContainText('Pilih file KML/KMZ')
    passed('Import file validation blocks invalid upload before API write')

    ;({ page } = await open('/admin/datasets/import', 'Administrator', 'empty'))
    await expect(page.locator('[data-import-history]')).toContainText('Belum ada impor')
    passed('Empty import history')

    let scenario = await open('/map', 'Administrator', 'error')
    page = scenario.page
    await expect(page.getByRole('heading', { name: 'Dataset aktif tidak dapat dimuat' })).toBeVisible()
    scenario.state.mode = 'normal'
    await page.locator('.retry-active-dataset').click()
    await expect(page.locator('.maplibregl-canvas')).toBeVisible()
    await page.getByRole('combobox', { name: 'Cari Asset ID, nama aset, lokasi, atau hostname' }).fill('C-01')
    await expect(page.locator('#sidebar-asset-search-results')).toBeVisible()
    passed('Map API error, retry and asset search')

    ;({ page } = await open('/topology'))
    const before = await page.locator('[data-topology-zoom-label]').textContent()
    await page.locator('[data-action=zoom-in]').click()
    await expect(page.locator('[data-topology-zoom-label]')).not.toHaveText(before)
    await page.locator('[data-action=zoom-reset]').click()
    await expect(page.locator('[data-topology-zoom-label]')).toHaveText('100%')
    passed('Topology zoom and reset')

    ;({ page } = await open('/admin/users', 'Viewer'))
    await expect.poll(() => new URL(page.url()).pathname).toBe('/map')
    await expect.poll(() => new URL(page.url()).searchParams.get('datasetId')).toBe('dataset-semarang')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible()
    await expect(page.locator('.user-menu-dropdown a[href^="/admin/"]')).toHaveCount(0)
    passed('Viewer admin-route redirect and hidden administrator menu')

    ;({ page } = await open('/map', 'anonymous'))
    await expect(page).toHaveURL('http://127.0.0.1:5173/')
    await expect(page.locator('#login-form')).toBeVisible()
    passed('Anonymous protected-route redirect')

    ;({ page } = await open('/map', 'Administrator', 'expired'))
    await expect(page).toHaveURL('http://127.0.0.1:5173/')
    await expect(page.locator('#login-form')).toBeVisible()
    passed('Expired session redirects to login')

    expect(errors).toEqual([])
    expect(unexpected).toEqual([])
    const output = process.env.BASELINE_OUTPUT_DIR ? path.resolve(process.env.BASELINE_OUTPUT_DIR) : path.join(__dirname, 'baseline')
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(path.join(output, 'smoke-results.json'), JSON.stringify({ checks, errors, unexpected, database: 'not connected; all API responses mocked' }, null, 2))
  } finally { if (context) await context.close(); await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
