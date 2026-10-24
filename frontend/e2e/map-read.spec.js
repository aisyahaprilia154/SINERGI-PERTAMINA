import { test, expect } from './test.js'
import fixtures from '../../docs/react-migration/capture-baseline.cjs'
async function setup(page, { role = 'Administrator', theme = 'light', failure = 0, pending = null, ready = true, url = '/e2e/fixtures/map.html?datasetId=dataset-semarang' } = {}) {
  const state = { calls: [], failure, pending, payload: structuredClone(fixtures.active) }, errors = [], modules = []
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => modules.push(request.url()))
  await page.addInitScript(({ user, theme }) => { sessionStorage.setItem('sinergiSessionToken', 'map-read-token'); sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user)); localStorage.setItem('sinergi.theme', theme) }, { user: { ...fixtures.user, role }, theme })
  await page.route(/^https:\/\/.*arcgisonline\.com\//, route => route.fulfill({ status: 404, body: '' }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    state.calls.push({ path, method: request.method(), token: request.headers().authorization })
    if (path.startsWith('/api/auth/')) return route.fulfill({ json: { user: { ...fixtures.user, role } } })
    if (path.endsWith('/active')) {
      if (state.pending) await state.pending
      return route.fulfill({ status: state.failure || 200, json: state.failure ? { error: { message: 'Dataset gagal' } } : state.payload })
    }
    if (path.includes('/active/assets/')) { const id = decodeURIComponent(path.split('/').at(-1)), asset = state.payload.assets.find(asset => asset.assetId === id || asset.id === id); return route.fulfill({json:{asset:{...asset,id},identity:{canonicalAssetId:id},activePointer:state.payload.activePointer}}) }
    if (path.endsWith('/planet')) return route.fulfill({ json: fixtures.basemap })
    if (path.endsWith('/overlays')) return route.fulfill({ json: { overlays: [] } })
    if (path.includes('/fonts/')) return route.fulfill({ body: Buffer.alloc(0) })
    throw new Error(`Unmocked read map endpoint ${request.method()} ${path}`)
  })
  await page.goto(url, { waitUntil: ready ? 'networkidle' : 'domcontentloaded' })
  if (ready && !failure) { await expect(page.locator('.maplibregl-canvas')).toBeVisible(); await expect(page.getByRole('button', { name: 'Perbesar peta' })).toBeEnabled() }
  return { state, errors, modules }
}
const search = page => page.getByRole('combobox', { name: 'Cari Asset ID, nama aset, lokasi, atau hostname' })
test('React map keeps one canvas through network, selection, URL history, theme and coverage changes', async ({ page }) => {
  const { state, errors, modules } = await setup(page)
  expect(modules.some(url => url.includes('/react/map/MapReadPage.jsx'))).toBe(true)
  expect(modules.some(url => url.includes('/pages/map/map-page.js'))).toBe(false)
  await page.locator('.maplibregl-canvas').evaluate(canvas => { window.mapCanvasMarker = canvas })
  await page.getByRole('button', { name: 'Sembunyikan Jaringan CCTV' }).click()
  await expect(page.getByText('Semua jaringan disembunyikan')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('selectedNetworkIds')).toBe('')
  await page.getByRole('button', { name: 'Tampilkan jaringan', exact: true }).click(); await page.getByRole('switch').click()
  await search(page).fill('C-01'); await search(page).press('ArrowDown'); await page.keyboard.press('Enter')
  await expect.poll(() => new URL(page.url()).searchParams.get('selectedAssetId')).toBe('C-01')
  await page.goBack(); await expect.poll(() => new URL(page.url()).searchParams.get('selectedAssetId')).toBeNull()
  await page.goForward(); await expect.poll(() => new URL(page.url()).searchParams.get('selectedAssetId')).toBe('C-01')
  await page.getByRole('button', { name: 'Aktifkan mode gelap' }).click()
  await expect(page.getByRole('button', { name: 'Aktifkan mode terang' })).toBeVisible()
  expect(await page.locator('.maplibregl-canvas').evaluate(canvas => canvas === window.mapCanvasMarker)).toBe(true)
  expect(state.calls.filter(call => !call.path.startsWith('/api/auth/')).every(call => call.method === 'GET')).toBe(true)
  expect(errors).toEqual([])
})
test('search keyboard, Ctrl K, presets, focus, basemap and legend controls stay usable', async ({ page }) => {
  const { errors } = await setup(page)
  await page.getByRole('button', { name: 'Tutup panel jaringan' }).click(); await page.keyboard.press('Control+k'); await expect(search(page)).toBeFocused()
  await search(page).fill('missing xyz'); await expect(page.getByText('Aset tidak ditemukan pada area aktif.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sembunyikan Jaringan CCTV' })).toBeVisible(); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Buka subkategori Jaringan CCTV' }).click(); await expect(page.locator('.network-subcategories')).toBeVisible()
  await page.getByRole('button', { name: 'Fokuskan peta ke Jaringan CCTV' }).click()
  await page.getByRole('button', { name: 'Perbesar peta' }).click(); await page.getByRole('button', { name: 'Perkecil peta' }).click()
  await page.getByRole('button', { name: 'Tampilkan legenda' }).click(); await expect(page.getByText('Legenda peta')).toBeVisible()
  await page.getByRole('button', { name: 'Pilih tampilan peta dasar' }).click(); await expect(page.getByText('Legenda peta')).toBeHidden()
  await page.getByRole('button', { name: /Citra satelit/ }).click()
  await page.getByRole('button', { name: 'Pilih tampilan peta dasar' }).click(); await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Pilih tampilan peta dasar' })).toBeFocused()
  expect(errors).toEqual([])
})
test('mobile map opens asset panel, supports selection and returns focus after Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { errors } = await setup(page, { theme: 'dark' })
  await page.getByRole('button', { name: 'Aset', exact: true }).click(); await expect(search(page)).toBeFocused()
  await expect(page.locator('.map-workspace')).toHaveClass(/sidebar-open/)
  await search(page).fill('C-01'); await page.getByRole('option', { name: /Pilih C-01/ }).click()
  await expect(page.locator('.map-workspace')).not.toHaveClass(/sidebar-open/)
  await page.getByRole('button', { name: 'Tutup detail aset' }).click()
  await page.getByRole('button', { name: 'Layer', exact: true }).click(); await page.keyboard.press('Escape')
  await expect(page.locator('.map-workspace')).not.toHaveClass(/sidebar-open/)
  await expect(page.getByRole('button', { name: 'Buka panel jaringan' })).toBeFocused()
  expect(errors).toEqual([])
})
test('Viewer read map handles error, retry and an empty dataset without admin actions', async ({ page }) => {
  const { state, errors } = await setup(page, { role: 'Viewer', failure: 500 })
  await expect(page.getByText('Dataset gagal')).toBeVisible()
  expect(await page.getByRole('button', { name: 'Import KML/KMZ' }).count()).toBe(0)
  state.failure = 0; state.payload = { ...fixtures.active, assets: [], geometries: [], relations: [], layers: [] }
  await page.getByRole('button', { name: 'Coba lagi' }).click(); await expect(page.getByText('Belum ada jaringan pada dataset aktif.')).toBeVisible()
  await expect(page.getByText('Layer aktif belum mempunyai geometri yang dapat ditampilkan')).toBeVisible()
  await expect(page.locator('button.diagram-toggle')).toBeDisabled()
  await page.getByRole('button', { name: /Menu akun/ }).click(); await expect(page.getByRole('menuitem', { name: 'Kelola pengguna' })).toHaveCount(0)
  expect(errors).toEqual([])
})
test('leaving the experimental page aborts its pending dataset request', async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve })
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = function (input, init) {
      if (String(input).endsWith('/active') && init?.signal) init.signal.addEventListener('abort', () => sessionStorage.setItem('mapReadAbortCount', String(Number(sessionStorage.getItem('mapReadAbortCount')) + 1)), { once: true })
      return original.apply(this, arguments)
    }
  })
  const { state, errors } = await setup(page, { pending, ready: false })
  await expect.poll(() => state.calls.some(call => call.path.endsWith('/active'))).toBe(true)
  await page.route('**/left', route => route.fulfill({ contentType: 'text/html', body: '<h1>Left map</h1>' }))
  const before = await page.evaluate(() => Number(sessionStorage.getItem('mapReadAbortCount')))
  await page.goto('/left')
  expect(await page.evaluate(() => Number(sessionStorage.getItem('mapReadAbortCount')))).toBeGreaterThan(before)
  release()
  await expect(page.getByRole('heading', { name: 'Left map' })).toBeVisible(); expect(errors).toEqual([])
})
test('production map route now loads React without the legacy page renderer', async ({ page }) => {
  const { modules } = await setup(page, { url: '/map?datasetId=dataset-semarang' })
  expect(modules.some(url => url.includes('/pages/map/map-page.js'))).toBe(false)
  expect(modules.some(url => url.includes('/react/map/MapReadPage.jsx'))).toBe(true)
})
