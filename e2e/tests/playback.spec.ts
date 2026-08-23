import { test, expect } from '@playwright/test'

// Scenario 2: a local file reaches the playlist and actually plays.
//
// Two of the brief's assumptions did not survive contact with the real
// bundle (see task-8-report.md for the full investigation):
//
// 1. Ctrl+O does nothing. `LocalSource.init` calls
//    `ctx.ui.registerShortcut('ctrl+o', ...)`, but
//    `WebampUIFeature.init` (src/renderers/webamp/WebampUIFeature.ts) never
//    binds a keydown listener over `registry.shortcuts` — there's a literal
//    `// TODO: bind a keydown listener ... (deferred — no module registers
//    shortcuts yet, YAGNI)` at the call site. The only real, already-wired
//    way to open a folder is GOAMP's own right-click context menu
//    (src/webamp/goamp-menu.ts), whose "Open Folder" item calls
//    `openFolder(webamp)` from src/webamp/file-actions.ts — the same
//    dialog+scan+setTracksToPlay path, just reached through the menu
//    instead of a shortcut. This test drives that real path. This is a
//    finding about app behaviour, not a workaround: per the task
//    constraints, src/ is not touched to "fix" the missing keybinding.
//
// 2. There is no `<audio>` element in the DOM to read `.currentTime` from.
//    Webamp's playback engine (node_modules/webamp/built/webamp.bundle.js,
//    `elementSource_ElementSource`) does `document.createElement("audio")`
//    but never appends it to the document — it's driven purely in memory
//    through Web Audio API nodes. `document.querySelector('audio')` reliably
//    returns null. What IS in the DOM and updates as the track plays is the
//    real Winamp seek bar: `<input id="position" type="range" min="0"
//    max="100" ... value="33.333...">`, where `value` is
//    `timeElapsed / duration * 100`. It updates once per elapsed second
//    (driven by the `timeupdate` -> `positionChange` -> Redux
//    `UPDATE_TIME_ELAPSED` chain), same as the visible clock digits, but as
//    a plain numeric attribute that's trivial to poll and assert on — and
//    it's the actual user-visible position indicator, not an implementation
//    detail. That's what this test reads.
//
// Fix round 1: the fixture is 10s (not 3s) specifically so the observation
// below has room. At one update tick per elapsed second, a 3s clip only
// gives {0, 33.3, 66.7, 100} — a single observed increase proves one tick
// fired, not that position is genuinely advancing, and a short paused-wait
// has too little margin against `timeupdate` jitter (~250ms, worse under
// CI load) before it risks reporting "frozen" on a track that is still
// playing. Ten seconds gives ten ticks of room: two independent increases
// prove advancing, and a ~2.5s paused-wait spans multiple tick boundaries,
// so jitter cannot produce a false "frozen" reading.
test('a local file loads and playback advances', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // The dialog shim's `open()` answers with the fixture directory
  // regardless of who calls it; the shim's `scan_directory`/`read_metadata`
  // entries answer with the fixture track. Reach "Open Folder" through
  // GOAMP's real right-click context menu (see comment above for why not
  // Ctrl+O).
  await page.locator('#main-window').click({ button: 'right' })
  const contextMenu = page.locator('#goamp-context-menu')
  await expect(contextMenu).toBeVisible()
  await contextMenu.getByText('Open Folder', { exact: true }).click()

  const playlist = page.locator('#playlist-window')
  await expect(playlist.getByText('Sample Tone')).toBeVisible({ timeout: 10_000 })

  await page.locator('#play').click()

  // Read the seek bar's `value` (0-100, percent of duration) rather than an
  // <audio> element, which doesn't exist in this DOM (see file header).
  const readPosition = () =>
    page.evaluate(() => {
      const el = document.getElementById('position') as HTMLInputElement | null
      return el ? parseFloat(el.value) : -1
    })

  // "Advancing" means two independent increases, not one tick. Poll for the
  // first increase above 0, then poll again for a further increase past
  // that — a stalled player that ticked exactly once (e.g. an initial
  // loaded-metadata nudge) would pass a single->0 check but not this one.
  // Generous timeouts (matching the existing 10s headroom style) so a
  // loaded runner doesn't go spuriously red.
  await expect.poll(readPosition, { timeout: 10_000 }).toBeGreaterThan(0)
  const firstTick = await readPosition()
  await expect.poll(readPosition, { timeout: 10_000 }).toBeGreaterThan(firstTick)
  const moving = await readPosition()

  await page.locator('#pause').click()

  // Bounded wait to prove the *absence* of further advancement, not to
  // detect advancement itself (that's the two polls above — legitimate use
  // of a fixed wait per the harness's "no waitForTimeout as primary sync"
  // rule). 2.5s spans at least two of the position bar's ~1s update ticks:
  // with the 10s fixture there is ample track remaining at this point (at
  // most ~2 ticks have elapsed), so a still-playing track could not
  // possibly hold the same value through jitter for that whole window, and
  // there's no risk of the wait itself running past end-of-track and
  // producing a false "frozen" reading via natural stop.
  await page.waitForTimeout(2_500)
  const paused = await readPosition()
  expect(paused).toBe(moving)

  await page.screenshot({ path: 'e2e/artifacts/playback.png', fullPage: true })
})
