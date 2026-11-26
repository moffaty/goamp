import { test, expect } from '../fixtures/network-lockdown'

async function openMenu(page: any) {
  await page.locator('#main-window').click({ button: 'right' })
  const menu = page.locator('#goamp-context-menu')
  await expect(menu).toBeVisible()
  return menu
}

test('scrobble panel closes on Escape', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  const menu = await openMenu(page)
  await menu.getByText('Scrobbling', { exact: true }).click()
  const overlay = page.locator('#scrobble-settings-overlay')
  await expect(overlay).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

test('radio panel closes on Escape', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  const menu = await openMenu(page)
  await menu.getByText('Internet Radio', { exact: true }).click()
  const panel = page.locator('#radio-panel-overlay')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('scrobble panel closes on outside click', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  const menu = await openMenu(page)
  await menu.getByText('Scrobbling', { exact: true }).click()
  const overlay = page.locator('#scrobble-settings-overlay')
  await expect(overlay).toBeVisible()
  // click far top-left corner, away from centered panel
  await page.mouse.click(5, 5)
  await expect(overlay).toBeHidden()
})
