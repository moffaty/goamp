// Stands in for @tauri-apps/* during L2. `invoke` replays the responses L1
// recorded from the real backend; everything else is the smallest behaviour the
// UI needs to run in a browser.
import golden from '../golden/index.json'

const responses = golden as Record<string, unknown>

export const calls: Array<{ command: string; args?: Record<string, unknown> }> = []

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
  duration: 3,
  genre: '',
}

const local: Record<string, unknown> = {
  scan_directory: [FIXTURE_TRACK],
  read_metadata: FIXTURE_TRACK,
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  calls.push({ command, args })
  if (command in local) return local[command] as T
  if (command in responses) return responses[command] as T
  if (command === 'resolve_track_id') return 'e2e-canonical-id' as T
  if (WRITE_COMMANDS.has(command) || command.startsWith('track_')) return null as T
  // Commands with no golden and not a known write-command are ones the gate
  // does not cover (sidecar, network). Reject the way the real backend would
  // when the sidecar is down, so the UI has to handle it rather than hanging.
  throw new Error(`[e2e] no golden for command: ${command}`)
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
