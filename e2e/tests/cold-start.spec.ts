import { test, expect } from '@playwright/test'

// Scenario 1 (UI half): the bundle boots, Webamp renders, nothing explodes.
// This is also the first thing in the repo that ever executes src/main.ts.
test('the app boots with a rendered player and no errors', async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('requestfailed', (r) => failedRequests.push(r.url()))

  await page.goto('/')

  // Webamp portals its entire UI to a node it appends to <body> rather than
  // rendering into the container it's given — #app itself stays empty by
  // design in this webamp version. So the real proof of a mount is the
  // Webamp main window, not the container div.
  await expect(page.locator('#app')).toBeAttached()
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // The app's own crash overlay must not have appeared.
  await expect(page.getByText('GOAMP startup failed')).toHaveCount(0)

  await page.screenshot({ path: 'e2e/artifacts/cold-start.png', fullPage: true })

  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
})
