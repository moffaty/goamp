// Opt into structural network lockdown, same as the other specs (see
// e2e/fixtures/network-lockdown.ts / shim-coverage.spec.ts).
import { test, expect } from '../fixtures/network-lockdown'

// Scenario 3: the context menu opens panels, and a panel behaves like a
// retro window — it drags, and its position survives a reload.
//
// The brief assumed `[data-panel="charts"]` as the panel selector. That
// selector does not exist anywhere in the bundle. The real, already-stable
// hook is `PanelHost` (src/webamp/PanelHost.ts), which stamps every
// dynamically-registered panel with `container.dataset.panelId = id`,
// i.e. `[data-panel-id="charts"]` — not `data-panel`. This is exactly the
// "stable, distinctive hook" the task brief asks to look for first,
// confirmed by grepping `registerPanel|togglePanel|data-panel` across
// src/renderers/webamp/WebampUIFeature.ts and src/core/, then following
// PanelHost.toggle() (src/webamp/PanelHost.ts:34-36). No production edit
// was needed — src/ is untouched by this task.
test('the Charts panel opens, drags, and survives a reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // Right-click the player to open GOAMP's own context menu (same real path
  // playback.spec.ts uses for "Open Folder" — Webamp's native context menu
  // is intercepted in favour of #goamp-context-menu).
  await page.locator('#main-window').click({ button: 'right' })
  const contextMenu = page.locator('#goamp-context-menu')
  await expect(contextMenu).toBeVisible()

  // Both dynamic menu items must be present — they're registered by
  // ChartsFeature and P2PFeature respectively (src/features/charts/ChartsFeature.ts,
  // src/features/p2p/P2PFeature.ts), appended after a separator by
  // buildDynamicMenuItems (src/webamp/goamp-menu.ts).
  await expect(contextMenu.getByText('Charts', { exact: true })).toBeVisible()
  await expect(contextMenu.getByText('Peers', { exact: true })).toBeVisible()

  await contextMenu.getByText('Charts', { exact: true }).click()

  const panel = page.locator('[data-panel-id="charts"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Your Top Tracks')).toBeVisible()

  // The default tab (Week) calls get_top_tracks_cmd, which has golden data
  // (Portishead "Roads" play_count 3, Massive Attack "Angel" play_count 1).
  // Assert the panel actually rendered real chart rows, not just its
  // static header — proves the shim round-trip, not merely that the DOM
  // node exists.
  await expect(panel.getByText(/Roads.*Portishead/)).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByText(/Angel.*Massive Attack/)).toBeVisible()

  await page.screenshot({ path: 'e2e/artifacts/panel-charts.png', fullPage: true })

  const before = await panel.boundingBox()
  if (!before) throw new Error('charts panel has no bounding box')

  // Drag it by its titlebar (.goamp-retro-titlebar, see retro.ts —
  // mousedown/mousemove/mouseup on the bar moves the container via
  // PanelHost's dragTarget).
  const titlebar = panel.locator('.goamp-retro-titlebar')
  await expect(titlebar).toBeVisible()
  const barBox = await titlebar.boundingBox()
  if (!barBox) throw new Error('charts panel titlebar has no bounding box')

  await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(barBox.x + barBox.width / 2 + 150, barBox.y + barBox.height / 2 + 80, {
    steps: 10,
  })
  await page.mouse.up()

  const after = await panel.boundingBox()
  if (!after) throw new Error('charts panel vanished after the drag')
  // Assert the position actually moved by a meaningful amount — a
  // no-op/broken drag would leave x unchanged (or only jitter by a few px).
  expect(Math.round(after.x - before.x), 'the panel must follow the cursor').toBeGreaterThan(50)

  // Position is persisted via onDragEnd -> storage.set(`panel-pos:charts`, ...)
  // (PanelHost.ts) into localStorage, which survives a same-origin reload.
  // It must come back where it was left.
  await page.reload()
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // Reopen the panel the same real way — via the context menu, not by
  // reaching into internals.
  await page.locator('#main-window').click({ button: 'right' })
  const contextMenuAfterReload = page.locator('#goamp-context-menu')
  await expect(contextMenuAfterReload).toBeVisible()
  await contextMenuAfterReload.getByText('Charts', { exact: true }).click()

  const restored = page.locator('[data-panel-id="charts"]')
  await expect(restored).toBeVisible()
  const box = await restored.boundingBox()
  if (!box) throw new Error('charts panel has no bounding box after reload')
  expect(Math.abs(box.x - after.x), 'the panel must reopen where it was left').toBeLessThan(8)
})
