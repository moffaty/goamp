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

  // Position must actually move — a paused/stalled player would keep
  // reporting 0. Read the seek bar's `value` (0-100, percent of duration)
  // rather than an <audio> element, which doesn't exist in this DOM (see
  // file header). Poll rather than sleep-then-check so this isn't tied to a
  // fixed timing assumption.
  const readPosition = () =>
    page.evaluate(() => {
      const el = document.getElementById('position') as HTMLInputElement | null
      return el ? parseFloat(el.value) : -1
    })

  await expect.poll(readPosition, { timeout: 10_000 }).toBeGreaterThan(0)
  const moving = await readPosition()

  await page.locator('#pause').click()

  // Bounded wait to prove the *absence* of further advancement, not to
  // detect the initial advancement (that's the poll above). The fixture
  // track is 3s and the seek bar updates once per elapsed second, so at the
  // moment we caught `moving` there are at least ~2s of track left; waiting
  // ~1.1s here would span a full update tick if pause had failed to stop
  // playback, while staying safely short of the track's end (which would
  // otherwise also freeze the value and falsely look "paused").
  await page.waitForTimeout(1_100)
  const paused = await readPosition()
  expect(paused).toBe(moving)

  await page.screenshot({ path: 'e2e/artifacts/playback.png', fullPage: true })
})
