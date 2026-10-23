import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  },
  projects: [{
    name: 'desktop-edge',
    use: { ...devices['Desktop Edge'], channel: process.env.BASELINE_BROWSER_CHANNEL || 'msedge' },
  }],
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173`,
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
