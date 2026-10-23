const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const { chromium } = require('playwright')
  const output = path.join(__dirname, 'stage-4')
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: process.env.BASELINE_BROWSER_CHANNEL || 'msedge' })
  const results = []
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport, colorScheme: theme, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
        await context.addInitScript(theme => localStorage.setItem('sinergi.theme', theme), theme)
        const page = await context.newPage(), errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto('http://127.0.0.1:5173/e2e/fixtures/shared.html', { waitUntil: 'networkidle' })
        await page.evaluate(() => document.fonts.ready)
        const headerBox = await page.locator('[data-app-header]').boundingBox()
        await page.locator('[data-app-header]').screenshot({ path: path.join(output, `header-${size}-${theme}.png`) })
        await page.screenshot({ path: path.join(output, `shared-${size}-${theme}.png`), fullPage: true })
        await page.getByRole('button', { name: 'Tambah pengguna', exact: true }).click()
        await page.getByLabel('Username').fill('Draft pengguna')
        await page.screenshot({ path: path.join(output, `drawer-${size}-${theme}.png`), fullPage: true })
        await page.getByRole('button', { name: 'Konfirmasi', exact: true }).click()
        await page.screenshot({ path: path.join(output, `dialog-${size}-${theme}.png`), fullPage: true })
        results.push({ size, theme, headerBox, errors })
        await context.close()
        console.log(`Captured shared components ${size}-${theme}`)
      }
    }
    await fs.writeFile(path.join(output, 'shared-capture-results.json'), JSON.stringify({ results }, null, 2))
    assert.deepEqual(results.flatMap(result => result.errors), [])
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
