// Proves e2e/shim/tauri.ts actually validates the *request* side of
// invoke(), not just the response side. Before this fix, golden was keyed by
// command name only: renaming a frontend argument (canonicalId ->
// canonical_id), dropping a required field, or sending the wrong type left
// every L2 test green while the real app would be dead on launch (Tauri
// rejects the invoke with a deserialization error). L1
// (src-tauri/src/verify/golden.rs, `argument_shapes_match_the_real_backend`)
// now records the argument shape the real backend accepted for every gate
// command; the shim validates incoming args against it and throws on any
// mismatch (missing key, unknown key, or wrong `typeof`).
//
// This drives the shim's real `invoke()` directly through the page — via
// `window.__E2E_INVOKE__`, which the shim exposes for exactly this purpose
// (a raw `page.evaluate(() => import('@tauri-apps/api/core'))` cannot
// resolve that bare specifier: Vite only rewrites imports it statically
// finds in served source, not ones constructed inside an injected `eval`) —
// rather than re-implementing the shim's validation logic in the test.
import { test, expect } from '../fixtures/network-lockdown'

test('the shim throws when a known command is called with a renamed argument key', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const result = await page.evaluate(async () => {
    const invoke = (window as any).__E2E_INVOKE__
    try {
      // get_top_tracks_cmd's recorded shape is { period, limit }. Renaming
      // `period` -> `range` is exactly the class of regression I1 named:
      // silent on the response side, invisible without request validation.
      await invoke('get_top_tracks_cmd', { range: 'week', limit: 10 })
      return { threw: false }
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) }
    }
  })

  expect(result.threw, 'invoke() must throw on a renamed argument key').toBe(true)
  expect(result.message).toContain('get_top_tracks_cmd')
  expect(result.message).toContain('period') // named in the error as missing
})

test('the shim throws when a known command argument has the wrong type', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const result = await page.evaluate(async () => {
    const invoke = (window as any).__E2E_INVOKE__
    try {
      // `limit` must be a number; sending a string is the "10" vs 10 class
      // of regression the review named explicitly.
      await invoke('get_top_tracks_cmd', { period: 'week', limit: '10' })
      return { threw: false }
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) }
    }
  })

  expect(result.threw, 'invoke() must throw when an argument type does not match').toBe(true)
  expect(result.message).toContain('limit')
})

test('the shim still accepts the real, unmodified argument shape', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const result = await page.evaluate(async () => {
    const invoke = (window as any).__E2E_INVOKE__
    try {
      const rows = await invoke('get_top_tracks_cmd', { period: 'all', limit: 50 })
      return { threw: false, isArray: Array.isArray(rows) }
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) }
    }
  })

  expect(result.threw, `unexpected throw: ${(result as any).message}`).toBe(false)
  expect(result.isArray).toBe(true)
})

test('write-commands with no golden response are still argument-validated', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  const result = await page.evaluate(async () => {
    const invoke = (window as any).__E2E_INVOKE__
    try {
      // record_track_signal's recorded shape is { canonicalId, signal, scope
      // }. `scope` dropped entirely — this command has no response golden,
      // so before this fix nothing at all would have caught this.
      await invoke('record_track_signal', { canonicalId: 'x', signal: 1 })
      return { threw: false }
    } catch (e) {
      return { threw: true, message: e instanceof Error ? e.message : String(e) }
    }
  })

  expect(result.threw, 'a write-command with a dropped argument must still throw').toBe(true)
  expect(result.message).toContain('record_track_signal')
  expect(result.message).toContain('scope')
})
