// Run with Node and Playwright available through NODE_PATH. Start Vite on 5173 first.
// All /api requests are intercepted; this script never uses an operational database.
const { chromium } = require('playwright')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

const output = process.env.BASELINE_OUTPUT_DIR ? path.resolve(process.env.BASELINE_OUTPUT_DIR) : path.join(__dirname, 'baseline')
const user = { id: 'baseline-admin', username: 'baseline', name: 'Baseline Administrator', role: 'Administrator', online: true, updatedAt: '2026-10-23T00:00:00Z' }
const viewer = { ...user, id: 'baseline-viewer', username: 'viewer', name: 'Baseline Viewer', role: 'Viewer', online: false }
const assets = [
  { id: 'switch', assetId: 'SW-01', name: 'SW-01', type: 'Switch', category: 'Infrastructure', diagramRole: 'rack-root' },
  { id: 'camera', assetId: 'C-01', name: 'C-01', type: 'CCTV', category: 'CCTV', diagramRole: 'end-device' },
].map(a => ({ ...a, location: 'Semarang', facilityName: 'FT Semarang', sourceFolderPath: '/RJBT/FT Semarang/CCTV', locationGroupKey: 'ft-semarang', locationGroupName: 'FT Semarang', layerId: 'network', properties: {} }))
const relations = [{ id: 'edge', sourceAssetId: 'SW-01', targetAssetId: 'C-01', relationType: 'connected_to', status: 'confirmed' }]
const active = {
  revision: 4, recordRevision: 4,
  activePointer: { datasetId: 'dataset-semarang', datasetVersionId: 'baseline', revision: 4 },
  datasetVersion: { id: 'baseline', datasetId: 'dataset-semarang', versionName: 'Baseline seminar', branchId: 'semarang' },
  layers: [{ id: 'network', name: 'FT Semarang', sourceFolderPath: '/RJBT/FT Semarang/CCTV', category: 'CCTV', defaultVisible: true }],
  assets, relations, mountingRelations: [], overlays: [],
  geometries: assets.map((a, i) => ({ id: `point-${i}`, assetNodeId: a.id, geometryType: 'point', coordinates: [110.4167 + i * 0.001, -6.9667 + i * 0.001] })),
}
const imported = { id: 'baseline-import', name: 'Tambahan CCTV', dataset_id: 'dataset-semarang', status: 'ready', source_filename: 'baseline.kml', created_at: '2026-10-23T00:00:00Z', summary: { addedAssets: 1, addedRelations: 0 } }
const proposed = { id: 'new-camera', name: 'C-02', kind: 'device', facility: { key: 'ft-semarang', name: 'FT Semarang' }, category: 'CCTV', diagramRole: 'end-device', properties: { assetType: 'CCTV' }, source: { folderPath: '/RJBT/FT Semarang/CCTV', geometry: { type: 'Point', coordinates: [110.4182, -6.9652] } } }
const preview = { import: imported, baseRevision: 4, summary: { addedAssets: 1, addedRelations: 0, existingAssets: 2, conflicts: 0 }, items: [{ id: 'new-camera', kind: 'asset', status: 'new', proposal: proposed }], additions: { assets: [proposed], relations: [] }, conflicts: [] }
const basemap = { tilejson: '3.0.0', tiles: [], vector_layers: ['boundary', 'building', 'housenumber', 'landcover', 'landuse', 'place', 'poi', 'transportation_name', 'transportation', 'water', 'waterway'].map(id => ({ id, fields: {} })) }
const routes = [
  ['login', '/', 'form'],
  ['users', '/admin/users', '[data-new-user]'],
  ['versions', '/admin/datasets/versions', '[data-save-version]:not(:disabled)'],
  ['imports', '/admin/datasets/import', '[data-open-import]:not(:disabled)'],
  ['preview', '/admin/datasets/import/baseline-import/preview', '[data-apply]:not(:disabled)'],
  ['map', '/map', '.maplibregl-canvas'],
  ['topology', '/topology', 'svg'],
]

async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: process.env.BASELINE_BROWSER_CHANNEL || 'msedge' })
  const results = []
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        for (const [name, url, ready] of routes) {
          const context = await browser.newContext({ viewport, colorScheme: theme, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
          const page = await context.newPage()
          const errors = [], unexpected = []
          page.on('pageerror', e => errors.push(e.message))
          await context.addInitScript(({ theme, login, user }) => {
            localStorage.setItem('sinergi.theme', theme)
            if (!login) {
              sessionStorage.setItem('sinergiSessionToken', 'mock-baseline-token')
              sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user))
            }
          }, { theme, login: name === 'login', user })
          await page.route('**/api/**', async route => {
            const request = route.request(), pathname = new URL(request.url()).pathname
            let data
            if (pathname === '/api/auth/me' || pathname === '/api/auth/heartbeat') data = { user }
            else if (pathname === '/api/admin/users') data = { users: [user, viewer], serverTime: '2026-10-23T00:00:00Z' }
            else if (pathname === '/api/import-config') data = { datasets: [{ id: 'dataset-semarang', name: 'SINERGI' }], maxFileSize: 60 * 1024 * 1024 }
            else if (pathname === '/api/imports') data = { imports: [imported] }
            else if (pathname.endsWith('/preview')) data = preview
            else if (pathname.endsWith('/versions')) data = { revision: 4, currentVersionId: 'baseline', versions: [{ id: 'baseline', name: 'Baseline seminar', created_at: '2026-10-23T00:00:00Z', actor_name: 'baseline', summary: { assets: 2, relations: 1 } }] }
            else if (pathname.endsWith('/active')) data = active
            else if (pathname.endsWith('/topology/graph')) data = { nodes: [], edges: [] }
            else if (pathname.endsWith('/overlays')) data = { overlays: [] }
            else if (pathname.endsWith('/planet')) data = basemap
            else if (pathname.includes('/fonts/')) return route.fulfill({ status: 200, body: Buffer.alloc(0), contentType: 'application/x-protobuf' })
            else { unexpected.push(`${request.method()} ${pathname}`); return route.fulfill({ status: 501, json: { error: { message: 'Unmocked baseline endpoint' } } }) }
            await route.fulfill({ status: 200, json: data })
          })
          try {
            await page.goto(`http://127.0.0.1:5173${url}`, { waitUntil: 'networkidle' })
            await page.locator(ready).first().waitFor({ timeout: 15000 })
            await page.evaluate(() => document.fonts.ready)
            await page.screenshot({ path: path.join(output, `${name}-${size}-${theme}.png`), fullPage: true })
            results.push({ name, size, theme, title: await page.title(), errors, unexpected, screenshot: `${name}-${size}-${theme}.png` })
            console.log(`Captured ${name}-${size}-${theme}`)
          } finally { await context.close() }
        }
      }
    }
    await fs.writeFile(path.join(output, 'capture-results.json'), JSON.stringify({ fixture: 'mock only; blank vector basemap, no external tile dependency', results }, null, 2))
    assert.equal(results.length, 28)
    assert.deepEqual(results.flatMap(r => r.errors), [], 'Browser runtime errors')
    assert.deepEqual(results.flatMap(r => r.unexpected), [], 'Unmocked API requests')
  } finally { await browser.close() }
}
module.exports = { user, viewer, active, preview, imported, basemap }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
