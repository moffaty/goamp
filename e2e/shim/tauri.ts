// Stands in for @tauri-apps/* during L2. `invoke` replays the responses L1
// recorded from the real backend; everything else is the smallest behaviour the
// UI needs to run in a browser.
import golden from '../golden/index.json'
import argShapes from '../golden/args/index.json'

const responses = golden as Record<string, unknown>
// Per-command argument shapes L1 recorded from what the real backend command
// actually accepted (src-tauri/src/verify/golden.rs,
// `argument_shapes_match_the_real_backend`). Used to validate the *request*
// side of every invoke() below — golden alone only ever validated the
// response side.
const shapes = argShapes as Record<string, Record<string, unknown>>

export const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
// Every invoke() that this shim rejected, with why. Exposed on `window` so
// specs can assert it stayed empty (or matches a named, reviewed allowlist)
// after a flow runs — a `.catch(() => {})` in production code otherwise
// makes a real IPC failure invisible to the gate.
export const rejections: Array<{ command: string; reason: string }> = []

function reject(command: string, reason: string): never {
  rejections.push({ command, reason })
  throw new Error(reason)
}

/// Validates `args` against the recorded shape for `command`, if one was
/// recorded. The key set must match exactly (no missing keys, no unknown
/// keys) and each value's `typeof` must match the recorded value's `typeof`.
/// This is what catches a renamed/dropped/retyped frontend argument — golden
/// being keyed by command name only meant that class of regression left
/// every L2 test green.
function validateArgs(command: string, args: Record<string, unknown> | undefined): void {
  const shape = shapes[command]
  if (!shape) return // no recorded shape for this command — nothing to check

  const expectedKeys = Object.keys(shape).sort()
  const actualKeys = Object.keys(args ?? {}).sort()

  const missing = expectedKeys.filter((k) => !actualKeys.includes(k))
  const unknown = actualKeys.filter((k) => !expectedKeys.includes(k))
  if (missing.length > 0 || unknown.length > 0) {
    reject(
      command,
      `[e2e] argument mismatch for \`${command}\`: expected keys [${expectedKeys.join(', ')}], ` +
        `received keys [${actualKeys.join(', ')}]` +
        (missing.length > 0 ? ` — missing: [${missing.join(', ')}]` : '') +
        (unknown.length > 0 ? ` — unknown: [${unknown.join(', ')}]` : ''),
    )
  }

  for (const key of expectedKeys) {
    const expectedType = typeof shape[key]
    const actualType = typeof (args as Record<string, unknown>)[key]
    if (expectedType !== actualType) {
      reject(
        command,
        `[e2e] argument type mismatch for \`${command}\`.${key}: expected ${expectedType}, ` +
          `received ${actualType} (value: ${JSON.stringify((args as Record<string, unknown>)[key])})`,
      )
    }
  }
}

// Write-commands the app fires during normal operation (listens, likes, session
// saves, tray/media-session updates, analytics, id resolution). None of these
// have a golden recording because they don't return meaningful read data, but
// throwing on them would surface as the crash overlay for the wrong reason —
// so they resolve to a stable, harmless value instead. Still recorded in
// `calls` so tests can assert on them.
const WRITE_COMMANDS = new Set([
  'record_track_listen',
  'record_track_signal',
  'set_track_like',
  'remove_track_like',
  'save_session',
  'update_tray_tooltip',
  'update_media_metadata',
  'update_media_playback',
  'track_event',
  'track_page_view',
])

// Fixture track for the local-playback scenario (Task 8). The dialog shim's
// `open` resolves to this directory, and these two commands are what
// LocalSource.scanDirectory/readMetadata call against it.
const FIXTURE_TRACK = {
  path: '/fixtures/sample.wav',
  artist: 'Fixture',
  title: 'Sample Tone',
  album: 'E2E',
  duration: 10,
  genre: '',
}

const local: Record<string, unknown> = {
  scan_directory: [FIXTURE_TRACK],
  read_metadata: FIXTURE_TRACK,
}

// Boot-time commands the shim answers with a fixed, harmless stub value
// rather than golden data or a WRITE_COMMANDS null. Neither is a golden
// recording (unlike `feature_flags_list`, `load_session`,
// `get_seed_enabled`, etc., which now ARE recorded — see below), so a
// response-shape drift here would NOT be caught. Documented so this stays a
// disclosed, reviewed gap rather than an accidental one (cold-start.spec.ts
// asserts `__E2E_REJECTIONS__` is empty, which is what made this list
// necessary in the first place — see that spec's header comment):
//
// - `cursor_position`: `src-tauri/src/commands/window.rs` queries the real
//   OS cursor position; there is no OS window under `MockRuntime`/headless
//   Chromium for L1 to record a meaningful value from, so this can never be
//   a golden recording. `src/webamp/window-drag.ts` polls it ~42x/sec purely
//   to decide click-through and tolerates any coordinate.
const BOOT_STUBS: Record<string, unknown> = {
  cursor_position: [0, 0],
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  calls.push({ command, args })
  validateArgs(command, args)
  if (command in local) return local[command] as T
  if (command in responses) return responses[command] as T
  if (command === 'resolve_track_id') return 'e2e-canonical-id' as T
  if (command in BOOT_STUBS) return BOOT_STUBS[command] as T
  if (WRITE_COMMANDS.has(command) || command.startsWith('track_')) return null as T
  // Commands with no golden and not a known write-command are ones the gate
  // does not cover (sidecar, network). Reject the way the real backend would
  // when the sidecar is down, so the UI has to handle it rather than hanging.
  reject(command, `[e2e] no golden for command: ${command}`)
}

export function convertFileSrc(path: string): string {
  return `/fixtures/${path.split('/').pop()}`
}

const noopWindow = {
  setAlwaysOnTop: async () => {},
  setAlwaysOnBottom: async () => {},
  setIgnoreCursorEvents: async () => {},
  outerPosition: async () => ({ x: 0, y: 0 }),
  innerSize: async () => ({ width: 275, height: 464 }),
  listen: async () => () => {},
  destroy: () => {},
}

export const getCurrentWindow = () => noopWindow
export const getCurrentWebviewWindow = () => ({ listen: async () => () => {} })
export const listen = async () => () => {}

// Dialog: the folder picker returns the fixture directory, which is what makes
// the local-playback scenario runnable without an OS dialog.
export const open = async () => '/fixtures'
export const openUrl = async () => {}
export const check = async () => null

// Lets specs assert which commands the UI actually issued, and which of
// those the shim rejected — and lets a spec call `invoke()` directly to
// exercise the shim's argument validation (shim-argument-validation.spec.ts)
// without re-implementing its logic. A raw `page.evaluate(() =>
// import('@tauri-apps/api/core'))` cannot resolve that bare specifier: Vite
// only rewrites imports it statically finds in served source, not ones
// constructed inside an injected `eval`. Exposing the function here is the
// smallest way around that without touching src/.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__E2E_CALLS__ = calls
  ;(window as unknown as Record<string, unknown>).__E2E_REJECTIONS__ = rejections
  ;(window as unknown as Record<string, unknown>).__E2E_INVOKE__ = invoke
}
