// Opt into structural network lockdown: e2e/fixtures/network-lockdown.ts
// blocks any request to a non-local origin at the route level and fails
// the test naming the URL, rather than relying on the environment having
// no internet or on requestfailed firing (it doesn't fire for a real
// unshimmed call that simply succeeds, or for a 404/500).
import { test, expect } from '../fixtures/network-lockdown'


// A whole-branch review measured that on cold start, 4 of the 5 commands
// main.ts's boot path issues (get_seed_enabled, list_moods, load_session,
// cursor_position) failed inside the shim and were swallowed by `.catch(()
// => {})` in application code — meaning this exact test was green while 80%
// of boot's IPC was failing. The fix has three parts, all landed:
// 1. e2e/shim/tauri.ts now records every invoke() it rejects into
//    `window.__E2E_REJECTIONS__` (command + reason), so a boot-time IPC
//    failure can no longer be silently absorbed by an app-side `.catch()`.
// 2. `load_session`, `get_seed_enabled` and `list_mood_channels` are now
//    real gate commands (src-tauri/src/verify/harness.rs GATE_COMMANDS)
//    with golden responses recorded from the real backend — no longer stubs.
// 3. `list_moods` never existed as a Tauri command at all: the frontend was
//    calling a name the backend does not have. That was a real product bug,
//    fixed by pointing src/recommendations/mood-service.ts at the commands
//    that do exist (`list_mood_channels`, `create_mood_channel`,
//    `delete_mood_channel`) — not by stubbing it.
// `cursor_position` (no OS window exists under MockRuntime to record from)
// remains the single documented BOOT_STUBS entry.
// The assertion below is the enforcement: if a *new* command starts failing
// during boot, this test goes red naming it, instead of the failure being
// invisible the way it was before this fix.
test('boot issues no unhandled IPC rejections', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  // Let the boot-time flows that fire slightly after first paint (session
  // restore, mood tabs, the click-through poller's first tick) settle.
  await page.waitForTimeout(500)

  const rejections = await page.evaluate(() => (window as any).__E2E_REJECTIONS__ ?? [])
  expect(
    rejections,
    `boot rejected these IPC calls (see this spec's header for the two categories that ` +
      `are expected to be empty here): ${JSON.stringify(rejections)}`,
  ).toEqual([])
})

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

  // No exemptions: a cold start must be console-error clean. The placeholder
  // track used to emit MEDIA_ERR_SRC_NOT_SUPPORTED on every boot; src/main.ts
  // now seeds a valid silent-WAV data URI, so that error must not reappear.
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
})

// The mood tabs are the visible payoff of fixing the `list_moods` ->
// `list_mood_channels` rename: before it, renderMoodTabs()'s invoke rejected
// and `.catch(() => {})` in WebampUIFeature swallowed it, so no tab ever
// rendered. The four names below are the backend's preset mood channels
// (e2e/golden/list_mood_channels.json, recorded from the real backend), so
// this goes red again if either side renames the command or the response.
test('boot renders the preset mood tabs from the backend', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const tabs = page.locator('#mood-tabs .mood-tab')
  await expect(tabs).toHaveCount(4)
  await expect(tabs).toHaveText(['Calm', 'Discovery', 'Energetic', 'Focus'])

  await page.screenshot({ path: 'e2e/artifacts/mood-tabs.png', fullPage: true })
})
