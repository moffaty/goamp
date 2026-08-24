// Opt into structural network lockdown, same as the other specs (see
// e2e/fixtures/network-lockdown.ts / shim-coverage.spec.ts).
import { test, expect } from '../fixtures/network-lockdown'
import topTracks from '../golden/get_top_tracks_cmd.json' with { type: 'json' }

// Scenario 4 (UI half): the rows the panel shows are the rows the real
// backend returned — the golden file came out of a real command in L1.
//
// Two corrections to the brief, both confirmed against the real bundle
// (panels.spec.ts already found the first one):
//
// 1. The panel hook is `[data-panel-id="charts"]`, not `[data-panel="charts"]`
//    — PanelHost (src/webamp/PanelHost.ts) stamps `container.dataset.panelId`.
// 2. `window.__E2E_CALLS__` did not already exist on `window` — Task 6 exposed
//    the `calls` array as a named export of e2e/shim/tauri.ts (`export const
//    calls = [...]`), not as a window global. This task adds the window
//    global itself (bottom of e2e/shim/tauri.ts), which is the smallest
//    change that lets a spec read the shim's call log without importing the
//    shim module directly (Playwright specs run in Node, not the page).
test('the charts panel renders the recorded backend rows in rank order', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  await page.locator('#main-window').click({ button: 'right' })
  const contextMenu = page.locator('#goamp-context-menu')
  await expect(contextMenu).toBeVisible()
  await contextMenu.getByText('Charts', { exact: true }).click()

  const panel = page.locator('[data-panel-id="charts"]')
  await expect(panel).toBeVisible()

  const rows = topTracks as Array<{ artist: string; title: string; play_count: number }>
  expect(rows.length, 'golden must not be empty — regenerate with make verify-golden').toBeGreaterThan(0)

  const top = rows[0]

  // Wait for the real row to render (the panel starts on "Loading…"), then
  // assert title, artist, and play count are all present together — proves
  // the shim round-trip rendered the actual record, not just static chrome.
  await expect(panel).toContainText(top.title, { timeout: 10_000 })
  await expect(panel).toContainText(top.artist)
  await expect(panel).toContainText(String(top.play_count))

  // Rank order is real: the most-played row must appear before every row
  // that follows it in the golden, not merely be present somewhere in the
  // panel. Checking against the *last* row alone would pass by accident if
  // there were exactly two rows and they happened to render in reverse but
  // some other row sat between them; checking every row after rank 1 rules
  // that out regardless of row count.
  const text = (await panel.textContent()) ?? ''
  const topIndex = text.indexOf(top.title)
  expect(topIndex, 'the top track must be present in the panel').toBeGreaterThanOrEqual(0)
  for (const other of rows.slice(1)) {
    const otherIndex = text.indexOf(other.title)
    expect(otherIndex, `${other.title} must be present in the panel`).toBeGreaterThanOrEqual(0)
    expect(topIndex, `rank 1 ("${top.title}") must come before "${other.title}"`).toBeLessThan(
      otherIndex,
    )
  }

  await page.screenshot({ path: 'e2e/artifacts/charts.png', fullPage: true })
})

test('switching to Month re-queries instead of reusing the week rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  await page.locator('#main-window').click({ button: 'right' })
  const contextMenu = page.locator('#goamp-context-menu')
  await expect(contextMenu).toBeVisible()
  await contextMenu.getByText('Charts', { exact: true }).click()

  const panel = page.locator('[data-panel-id="charts"]')
  await expect(panel).toBeVisible()

  const rows = topTracks as Array<{ title: string }>
  // Wait for the initial Week load to land before touching call counts, so
  // the "before" count reflects a settled panel, not a race with the first load.
  await expect(panel).toContainText(rows[0].title, { timeout: 10_000 })

  // `window.__E2E_CALLS__` is a single append-only log fed by
  // `src/webamp/window-drag.ts`'s `setupClickThrough()`, which polls
  // `cursor_position` continuously in the background (measured ~42 calls/sec,
  // unrelated to this test). Reading the raw length or the array's tail is
  // therefore both vacuous — the counter climbs whether or not the Month
  // click did anything — and racy — the tail is only `get_top_tracks_cmd`
  // for a ~24ms window out of every ~24ms cycle. Filter by command name
  // instead, the same idiom `recordSignalCalls` already uses in
  // autoplay.spec.ts, so the count can only advance because of a real
  // `get_top_tracks_cmd` call and "last" is unambiguous.
  const chartCalls = () =>
    page.evaluate(() =>
      ((window as any).__E2E_CALLS__ ?? []).filter(
        (c: { command: string }) => c.command === 'get_top_tracks_cmd',
      ),
    )

  const callsBefore = (await chartCalls()).length
  expect(callsBefore, '__E2E_CALLS__ must be populated by the initial Week load').toBeGreaterThan(0)

  await panel.getByText('Month', { exact: true }).click()

  await expect.poll(async () => (await chartCalls()).length).toBeGreaterThan(callsBefore)

  // The shim serves the same golden rows for every period (single fixture
  // file), so the rendered rows cannot distinguish Week from Month — the
  // only way to prove a real re-query happened is to inspect the call the
  // UI actually issued, which is exactly what the shim's (filtered) call log
  // is for.
  const last = (await chartCalls()).at(-1)
  expect(last.command).toBe('get_top_tracks_cmd')
  expect(last.args.period).toBe('month')
})
