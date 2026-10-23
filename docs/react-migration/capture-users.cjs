// Start Vite first. API and writes are mocked; legacy reference uses unchanged source.
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { user, viewer } = require('./capture-baseline.cjs')

async function main() {
  const { chromium } = require('playwright')
  const output = path.join(__dirname, 'stage-5')
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: process.env.BASELINE_BROWSER_CHANNEL || 'msedge' })
  const results = []
  try {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        for (const implementation of ['legacy', 'react']) {
          const context = await browser.newContext({ viewport, colorScheme: theme, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
          const page = await context.newPage(), errors = [], unexpected = []
          page.on('pageerror', error => errors.push(error.message))
          await context.addInitScript(({ theme, user }) => {
            localStorage.setItem('sinergi.theme', theme)
            sessionStorage.setItem('sinergiSessionToken', 'visual-mock-token')
            sessionStorage.setItem('sinergiSessionUser', JSON.stringify(user))
          }, { theme, user })
          if (implementation === 'legacy') await page.route('**/src/main.js', route => route.fulfill({ contentType: 'text/javascript', body: "import '/src/legacy-main.js'" }))
          await page.route('**/api/**', route => {
            const p = new URL(route.request().url()).pathname
            if (p === '/api/auth/me' || p === '/api/auth/heartbeat') return route.fulfill({ json: { user } })
            if (p === '/api/admin/users' && route.request().method() === 'GET') return route.fulfill({ json: { users: [user, viewer], serverTime: '2026-10-23T00:00:00Z' } })
            unexpected.push(`${route.request().method()} ${p}`)
            return route.fulfill({ status: 501, json: {} })
          })
          try {
            await page.goto('http://127.0.0.1:5173/admin/users', { waitUntil: 'networkidle' })
            await page.getByText('2 pengguna', { exact: true }).waitFor()
            await page.evaluate(() => document.fonts.ready)
            const capture = async state => {
              const screenshot = `${implementation}-${state}-${size}-${theme}.png`
              await page.screenshot({ path: path.join(output, screenshot), fullPage: true })
              results.push({ implementation, state, size, theme, screenshot })
            }
            await capture('list')
            await page.locator('[data-new-user]').click()
            await page.getByLabel('Username', { exact: true }).waitFor()
            await capture('create')
            await page.getByLabel('Username', { exact: true }).fill('draft-user')
            await page.keyboard.press('Escape')
            await page.locator('[data-confirm-discard]').waitFor()
            await capture('discard')
            await page.locator('[data-confirm-discard]').click()
            await page.locator(`[data-edit-user="${user.id}"]`).click()
            await page.locator('[data-reset-password]').waitFor()
            await capture('edit')
            await page.locator('[data-reset-password]').click()
            await page.getByLabel('Password baru').waitFor()
            await capture('password')
            assert.deepEqual(errors, [])
            assert.deepEqual(unexpected, [])
            console.log(`Captured ${implementation} users ${size}-${theme}`)
          } finally { await context.close() }
        }
      }
    }
    await fs.writeFile(path.join(output, 'capture-results.json'), JSON.stringify({ results }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
