import { test, expect } from '../fixtures/network-lockdown'

async function openMenu(page: any) {
  await page.locator('#main-window').click({ button: 'right' })
  const menu = page.locator('#goamp-context-menu')
  await expect(menu).toBeVisible()
  return menu
}

test('scrobble panel closes on ✕', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  let menu = await openMenu(page)
  await menu.getByText('Scrobbling', { exact: true }).click()
  const overlay = page.locator('#scrobble-settings-overlay')
  await expect(overlay).toBeVisible()

  await page.locator('#scrobble-close').click()
  await expect(overlay).toBeHidden()
})

test('radio panel closes on ✕', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const menu = await openMenu(page)
  await menu.getByText('Internet Radio', { exact: true }).click()
  const panel = page.locator('#radio-panel-overlay')
  await expect(panel).toBeVisible()

  await page.locator('#radio-close').click()
  await expect(panel).toBeHidden()
})

test('scrobble panel reopens after close (toggle flag stays in sync)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const overlay = page.locator('#scrobble-settings-overlay')

  let menu = await openMenu(page)
  await menu.getByText('Scrobbling', { exact: true }).click()
  await expect(overlay).toBeVisible()
  await page.locator('#scrobble-close').click()
  await expect(overlay).toBeHidden()

  // reopen
  menu = await openMenu(page)
  await menu.getByText('Scrobbling', { exact: true }).click()
  await expect(overlay).toBeVisible()
})
