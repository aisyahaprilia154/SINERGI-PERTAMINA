import { test as base, expect } from '@playwright/test'

// Behavior tests must not depend on external font/CDN availability.
// Visual captures use a separate script that still loads the original fonts.
export const test = base.extend({
  externalFontIsolation: [async ({ context }, use) => {
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort())
    await use()
  }, { auto: true }],
})
export { expect }
