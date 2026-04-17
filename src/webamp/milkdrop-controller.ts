import type { PlayerStore } from '../player/PlayerStore'

const MILKDROP_X = 275
const MILKDROP_Y = 0

let _store: PlayerStore | null = null

/**
 * Call once during app setup, after webamp has rendered.
 * Webamp creates the milkdrop genWindow (open:false) via __butterchurnOptions;
 * pre-set position so the first open has no x:0 flash.
 */
export function initMilkdropController(store: PlayerStore): void {
  _store = store
  store.dispatch({
    type: 'UPDATE_WINDOW_POSITIONS',
    positions: { milkdrop: { x: MILKDROP_X, y: MILKDROP_Y } },
    absolute: true,
  })
}

/**
 * Toggle milkdrop open/close.
 * Uses PlayerStore.toggleMilkdrop so ENABLE_MILKDROP vs TOGGLE_WINDOW is
 * handled correctly (first open vs subsequent). On open, snaps position to
 * x:275 (right edge of the player) so it appears flush with the player.
 */
export function toggleMilkdrop(): void {
  if (!_store) return
  const wasOpen = _store.isMilkdropOpen()
  _store.toggleMilkdrop()
  const isNowOpen = _store.isMilkdropOpen()
  if (!wasOpen && isNowOpen) {
    // Just opened — snap to player's right edge
    _store.dispatch({
      type: 'UPDATE_WINDOW_POSITIONS',
      positions: { milkdrop: { x: MILKDROP_X, y: MILKDROP_Y } },
      absolute: true,
    })
  }
}
