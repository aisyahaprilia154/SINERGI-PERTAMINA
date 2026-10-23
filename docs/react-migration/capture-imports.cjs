const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { user } = require('./capture-baseline.cjs')
async function main() {
  const { chromium } = require('playwright')
  const output = path.join(__dirname, 'stage-7'); await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'msedge' }), results = []
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        for (const implementation of ['legacy', 'react']) {
          const context = await browser.newContext({ viewport, colorScheme: theme, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
          const page = await context.newPage(), errors = [], unexpected = []
          let history = [{ id: 'baseline', name: 'Baseline seminar', source_filename: 'Semarang.kmz', dataset_id: 'dataset-semarang', status: 'ready', created_at: '2026-10-23T00:00:00Z', summary: { addedAssets: 2, addedRelations: 1 } }]
          page.on('pageerror', error => errors.push(error.message))
          await context.addInitScript(({ theme, user }) => { localStorage.setItem('sinergi.theme', theme); sessionStorage.setItem('sinergiSessionToken', 'visual-mock-token'); sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user)) }, { theme, user })
          if (implementation === 'legacy') await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/legacy-main.js'" }))
          await page.route('**/api/**', route => {
            const request = route.request(), p = new URL(request.url()).pathname
            if (p.startsWith('/api/auth/')) return route.fulfill({ json: { user } })
            if (p === '/api/import-config') return route.fulfill({ json: { datasets: [{ id: 'dataset-semarang', name: 'SINERGI' }], maxFileSize: 60 * 1024 * 1024 } })
            if (p === '/api/imports' && request.method() === 'GET') return route.fulfill({ json: { imports: history } })
            unexpected.push(`${request.method()} ${p}`); return route.fulfill({ status: 501, json: {} })
          })
          try {
            const load = async () => { await page.goto('http://127.0.0.1:5173/admin/datasets/import', { waitUntil: 'networkidle' }); await page.locator('[data-open-import]:not(:disabled)').waitFor(); await page.evaluate(() => document.fonts.ready) }
            const capture = async state => { const screenshot = `${implementation}-${state}-${size}-${theme}.png`; await page.screenshot({ path: path.join(output, screenshot), fullPage: true }); results.push({ implementation, state, size, theme, screenshot }) }
            const part = async (name, locator) => locator.screenshot({ path: path.join(output, `${implementation}-${name}-${size}-${theme}.png`) })
            await load(); await capture('list'); await part('table', page.locator('[data-import-history]')); await part('header', page.locator('header'))
            await page.locator('[data-open-import]').click(); await capture('drawer'); await part('drawer-panel', page.locator('.au-editor').filter({ visible: true }))
            await page.getByLabel('Nama impor').fill('Draft seminar'); await page.keyboard.press('Escape'); await capture('discard'); await part('discard-panel', page.locator('.au-editor').filter({ visible: true }))
            await page.getByRole('button', { name: 'Buang draft', exact: true }).click()
            history = []; await load(); await page.getByText('Belum ada impor.').waitFor(); await capture('empty')
            assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
            console.log(`Captured ${implementation} imports ${size}-${theme}`)
          } finally { await context.close() }
        }
      }
    }
    await fs.writeFile(path.join(output, 'capture-results.json'), JSON.stringify({ results }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
