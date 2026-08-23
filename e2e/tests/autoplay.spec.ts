// Opt into structural network lockdown, same as the other specs (see
// e2e/fixtures/network-lockdown.ts).
import { test, expect, type Page } from '../fixtures/network-lockdown'

// Scenario 5 (UI half): the per-track feedback keys (L/D/N) reach the
// backend with the right signal — this is what the mood engine and the
// hybrid recommender are driven by.
//
// Corrections to the brief's draft (src/features/autoplay/AutoplayFeature.ts
// around line 225, and src/features/autoplay/autoplay-feedback.ts):
//
// 1. There is no `set_track_like` command in this codebase — the brief's
//    filter included it speculatively. The real write path is
//    `recordTrackSignal()`, which first calls `resolve_track_id` (the shim
//    always answers 'e2e-canonical-id') and then `record_track_signal` with
//    `{ canonicalId, signal, scope: 'global' }`. Both are in the shim's
//    WRITE_COMMANDS set (e2e/shim/tauri.ts) so they resolve instead of
//    throwing, and both land in `__E2E_CALLS__`.
// 2. The loose `toMatch(/-1|false|dislike/)` regex from the brief is
//    replaced with an exact structural match on `last.args` — the brief
//    itself calls this out as the thing to do once the real command is
//    pinned down.
// 3. `n` is explicitly local-only per a code comment at the keydown handler
//    ("Normal is a local-only state — no backend signal sent."). This file
//    asserts that absence, not a call.
//
// The fixture track (e2e/shim/tauri.ts FIXTURE_TRACK) has both an artist
// ('Fixture') and a title ('Sample Tone'), so the handler's
// `if (!t || (!t.artist && !t.title)) return` guard does not swallow the
// keypress — confirmed by the 'd' and 'l' tests below actually observing a
// call.

const CANONICAL_ID = 'e2e-canonical-id' // what the shim's resolve_track_id always answers

async function openAndPlayFixtureTrack(page: Page) {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // Reach "Open Folder" through GOAMP's real context menu — Ctrl+O is not
  // wired to anything (see playback.spec.ts header comment). The dialog
  // shim answers with the fixture directory regardless of who calls it.
  await page.locator('#main-window').click({ button: 'right' })
  const contextMenu = page.locator('#goamp-context-menu')
  await expect(contextMenu).toBeVisible()
  await contextMenu.getByText('Open Folder', { exact: true }).click()

  const playlist = page.locator('#playlist-window')
  await expect(playlist.getByText('Sample Tone')).toBeVisible({ timeout: 10_000 })

  await page.locator('#play').click()

  // Blur whatever currently has focus before sending keys.
  //
  // AutoplayFeature's handler explicitly ignores keydowns whose target is
  // an <input>/<textarea>/contentEditable element (so typing in a real
  // input never triggers L/D/N). Clicking #main-window does not land on
  // neutral chrome: Webamp's volume slider (`<input type="range"
  // title="Volume Bar">`, parented under `#volume`) sits at the click
  // point and ends up focused, which made the very same guard swallow
  // every keypress in this file's first draft — confirmed by dispatching a
  // synthetic keydown (which bypasses focus and did reach the handler)
  // against a real `page.keyboard.press`, which did not, and then
  // inspecting `document.activeElement` between the two. Blurring here
  // (test-side only — no src/ change) moves focus off that input so the
  // handler's guard does not apply.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

const recordSignalCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as any).__E2E_CALLS__ ?? []).filter(
      (c: { command: string }) => c.command === 'record_track_signal',
    ),
  )

test('pressing d sends a -1 signal for the playing track', async ({ page }) => {
  await openAndPlayFixtureTrack(page)

  await page.keyboard.press('d')

  await expect.poll(async () => (await recordSignalCalls(page)).length).toBeGreaterThan(0)

  const calls = await recordSignalCalls(page)
  expect(calls).toHaveLength(1)
  expect(calls[0].args).toEqual({
    canonicalId: CANONICAL_ID,
    signal: -1,
    scope: 'global',
  })

  await page.screenshot({ path: 'e2e/artifacts/autoplay-dislike.png', fullPage: true })
})

test('pressing l sends a +1 signal for the playing track', async ({ page }) => {
  await openAndPlayFixtureTrack(page)

  await page.keyboard.press('l')

  await expect.poll(async () => (await recordSignalCalls(page)).length).toBeGreaterThan(0)

  const calls = await recordSignalCalls(page)
  expect(calls).toHaveLength(1)
  expect(calls[0].args).toEqual({
    canonicalId: CANONICAL_ID,
    signal: 1,
    scope: 'global',
  })

  await page.screenshot({ path: 'e2e/artifacts/autoplay-like.png', fullPage: true })
})

test('pressing n sends no backend signal (local-only state)', async ({ page }) => {
  await openAndPlayFixtureTrack(page)

  await page.keyboard.press('n')

  // Bounded wait to prove the *absence* of a call, not to detect one — the
  // right tool per the harness's "no waitForTimeout as primary sync" rule,
  // which explicitly carves out this case. 2s comfortably exceeds how long
  // the 'd'/'l' tests above take to observe their call (they resolve near-
  // instantly against the shim, no real network round-trip), so if 'n' ever
  // started sending a signal this wait would have plenty of time to catch it.
  await page.waitForTimeout(2_000)

  const calls = await recordSignalCalls(page)
  expect(calls, `'n' must not send a backend signal, got ${JSON.stringify(calls)}`).toEqual([])

  await page.screenshot({ path: 'e2e/artifacts/autoplay-normal.png', fullPage: true })
})
