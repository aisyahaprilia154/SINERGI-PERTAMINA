import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'

test('active login remains legacy and does not load the React root', async ({ page }) => {
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  await expect(page.locator('#login-form')).toBeVisible()
  await page.locator('#password').fill('fixture-password')
  await page.locator('.password-toggle').click()
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  expect(requests.some(url => url.includes('/src/react/bootstrap.jsx'))).toBe(false)
})

test('isolated JSX route works and leaves through document navigation', async ({ page }) => {
  await page.goto('/e2e/fixtures/react.html')
  await page.getByRole('button', { name: 'Hitungan 0' }).click()
  await expect(page.getByRole('button', { name: 'Hitungan 1' })).toBeVisible()
  await page.getByRole('link', { name: 'Kembali ke login' }).click()
  await expect(page.locator('#login-form')).toBeVisible()
})

test('initial route loading resolves to the React page', async ({ page }) => {
  await page.goto('/e2e/fixtures/react.html?case=loading', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('status')).toHaveText('Memuat halaman…')
  await expect(page.getByRole('heading', { name: 'Fondasi React' })).toBeVisible()
})

test('route loader failure has a document retry link', async ({ page }) => {
  await page.goto('/e2e/fixtures/react.html?case=loader-error')
  await expect(page.getByRole('alert')).toContainText('Halaman tidak dapat dimuat')
  await expect(page.getByRole('link', { name: 'Muat ulang' })).toHaveAttribute('href', page.url())
})

test('render failure stays within the error boundary', async ({ page }) => {
  await page.goto('/e2e/fixtures/react.html')
  await page.getByRole('button', { name: 'Picu error' }).click()
  await expect(page.getByRole('alert')).toContainText('Halaman tidak dapat dimuat')
})

test('Fast Refresh updates JSX while preserving component state', async ({ page }) => {
  const fixture = new URL('./fixtures/FoundationLab.jsx', import.meta.url)
  const original = await readFile(fixture, 'utf8')
  await page.goto('/e2e/fixtures/react.html')
  await page.getByRole('button', { name: 'Hitungan 0' }).click()
  await page.evaluate(() => { window.foundationDocumentMarker = 'same-document' })
  try {
    await writeFile(fixture, original.replace('<h1>Fondasi React</h1>', '<h1>Fondasi React HMR</h1>'))
    await expect(page.getByRole('heading', { name: 'Fondasi React HMR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hitungan 1' })).toBeVisible()
    expect(await page.evaluate(() => window.foundationDocumentMarker)).toBe('same-document')
  } finally {
    await writeFile(fixture, original)
  }
  await expect(page.getByRole('heading', { name: 'Fondasi React', exact: true })).toBeVisible()
})
