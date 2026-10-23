const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { user } = require('./capture-baseline.cjs')
async function main() {
  const { chromium } = require('playwright')
  const output = path.join(__dirname, 'stage-6')
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: process.env.BASELINE_BROWSER_CHANNEL || 'msedge' })
  const results = []
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        for (const implementation of ['legacy', 'react']) {
          const context = await browser.newContext({ viewport, colorScheme: theme, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
          const page = await context.newPage(), errors = [], unexpected = []
          const baseline = { id: 'baseline', name: 'Baseline seminar', created_at: '2026-10-23T00:00:00Z', actor_name: 'baseline', summary: { assets: 2, relations: 1 } }
          let data = { revision: 4, currentVersionId: 'baseline', versions: [baseline] }
          page.on('pageerror', error => errors.push(error.message))
          await context.addInitScript(({ theme, user }) => {
            localStorage.setItem('sinergi.theme', theme)
            sessionStorage.setItem('sinergiSessionToken', 'visual-mock-token')
            sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user))
          }, { theme, user })
          if (implementation === 'legacy') await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/legacy-main.js'" }))
          await page.route('**/api/**', route => {
            const request = route.request(), p = new URL(request.url()).pathname
            if (p === '/api/auth/me' || p === '/api/auth/heartbeat') return route.fulfill({ json: { user } })
            if (p === '/api/import-config') return route.fulfill({ json: { datasets: [{ id: 'dataset-semarang', name: 'SINERGI' }], maxFileSize: 60 * 1024 * 1024 } })
            if (p === '/api/datasets/dataset-semarang/versions' && request.method() === 'GET') return route.fulfill({ json: data })
            unexpected.push(`${request.method()} ${p}`)
            return route.fulfill({ status: 501, json: {} })
          })
          try {
            await page.goto('http://127.0.0.1:5173/admin/datasets/versions', { waitUntil: 'networkidle' })
            await page.locator('[data-save-version]:not(:disabled)').waitFor()
            await page.evaluate(() => document.fonts.ready)
            const capture = async state => {
              const screenshot = `${implementation}-${state}-${size}-${theme}.png`
              await page.screenshot({ path: path.join(output, screenshot), fullPage: true })
              results.push({ implementation, state, size, theme, screenshot })
            }
            await capture('list')
            await page.locator('[data-save-version]').click()
            await page.getByLabel('Nama versi').waitFor()
            await capture('save')
            await page.keyboard.press('Escape')
            data = { ...data, versions: [baseline, { ...baseline, id: 'older', name: 'Sebelum koreksi' }] }
            await page.evaluate(() => window.dispatchEvent(new Event('focus')))
            await page.locator('[data-restore-version=older]:not(:disabled)').waitFor()
            await page.locator('[data-restore-version=older]').click()
            await page.getByRole('dialog').waitFor()
            await capture('restore')
            await page.keyboard.press('Escape')
            data = { revision: 4, currentVersionId: null, versions: [] }
            await page.evaluate(() => window.dispatchEvent(new Event('focus')))
            await page.getByText('Belum ada versi tersimpan. Simpan keadaan saat ini untuk membuat titik pemulihan.').waitFor()
            await capture('empty')
            assert.deepEqual(errors, [])
            assert.deepEqual(unexpected, [])
            console.log(`Captured ${implementation} versions ${size}-${theme}`)
          } finally { await context.close() }
        }
      }
    }
    await fs.writeFile(path.join(output, 'capture-results.json'), JSON.stringify({ results }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
