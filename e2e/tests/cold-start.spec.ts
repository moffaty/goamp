// Opt into structural network lockdown: e2e/fixtures/network-lockdown.ts
// blocks any request to a non-local origin at the route level and fails
// the test naming the URL, rather than relying on the environment having
// no internet or on requestfailed firing (it doesn't fire for a real
// unshimmed call that simply succeeds, or for a 404/500).
import { test, expect } from '../fixtures/network-lockdown'

// Known, allowlisted-pending-a-product-decision console error: webamp's own
// audio-element error handler (node_modules/webamp/built/webamp.bundle.js,
// `console.error("MEDIA_ERR_SRC_NOT_SUPPORTED", e)`) fires because
// src/main.ts seeds Webamp's initial playlist with a placeholder track that
// has `url: ''`. This fires on EVERY cold start, including in the real Tauri
// webview — it is not a harness artifact. It is allowlisted here because the
// plan owner ruled that patching src/main.ts (e.g. embedding a silent-audio
// data URI) purely to silence a third-party console.error is worse
// engineering than documenting a known, user-invisible (no devtools in
// production) issue — not because the error is harmless noise. This is a
// tracked exemption, not a blanket pass: it matches only this exact message,
// and the test below asserts the error was actually observed, so if someone
// fixes the placeholder track this allowlist entry goes stale loudly instead
// of silently.
const ALLOWLISTED_CONSOLE_ERRORS = ['MEDIA_ERR_SRC_NOT_SUPPORTED Event']

// A whole-branch review measured that on cold start, 4 of the 5 commands
// main.ts's boot path issues (get_seed_enabled, list_moods, load_session,
// cursor_position) failed inside the shim and were swallowed by `.catch(()
// => {})` in application code — meaning this exact test was green while 80%
// of boot's IPC was failing. The fix has two parts, both landed:
// 1. e2e/shim/tauri.ts now records every invoke() it rejects into
//    `window.__E2E_REJECTIONS__` (command + reason), so a boot-time IPC
//    failure can no longer be silently absorbed by an app-side `.catch()`.
// 2. Of the four that were failing: `load_session` and `get_seed_enabled`
//    are now real gate commands (src-tauri/src/verify/harness.rs
//    GATE_COMMANDS) with real golden responses recorded from the real
//    backend — no longer stubs. `cursor_position` (no OS window exists
//    under MockRuntime to record from) and `list_moods` (no such Tauri
//    command exists in src-tauri at all — a real product bug, not a harness
//    gap) are answered by a documented, reviewed stub in
//    e2e/shim/tauri.ts's BOOT_STUBS.
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

  const unexpectedConsoleErrors = consoleErrors.filter(
    (msg) => !ALLOWLISTED_CONSOLE_ERRORS.includes(msg),
  )
  expect(
    unexpectedConsoleErrors,
    `console errors: ${unexpectedConsoleErrors.join(' | ')}`,
  ).toEqual([])
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])

  // The allowlist must stay honest: if webamp ever stops emitting this
  // specific error (e.g. the placeholder track gets fixed), fail loudly
  // instead of letting a dead exemption sit here forever.
  for (const allowlisted of ALLOWLISTED_CONSOLE_ERRORS) {
    expect(
      consoleErrors,
      `expected allowlisted console error not observed: ${allowlisted}`,
    ).toContain(allowlisted)
  }
})
