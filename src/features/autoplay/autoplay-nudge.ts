/**
 * Small persistent prompt asking the user to rate the currently playing track.
 *
 * Lives in its own DOM element so the busy autoplay-status plashka can't
 * overwrite it. Stays visible until the user presses L / D / N (or
 * hideRateNudge is called explicitly).
 */

let el: HTMLElement | null = null

function ensureEl(): HTMLElement {
  // The cached node may have been detached by tests or external clearing —
  // re-create when the cached reference is no longer in the DOM.
  if (el && el.isConnected) return el
  el = document.createElement('div')
  el.id = 'goamp-autoplay-nudge'
  Object.assign(el.style, {
    position: 'fixed',
    left: '6px',
    bottom: '42px',
    background: 'rgba(30, 30, 40, 0.92)',
    color: '#ffeb55',
    font: '11px/1.4 monospace',
    padding: '5px 10px',
    border: '1px solid #ffeb55',
    borderRadius: '3px',
    zIndex: '999991',
    pointerEvents: 'none',
    maxWidth: '340px',
  })
  document.body.appendChild(el)
  return el
}

export function showRateNudge(): void {
  const e = ensureEl()
  e.textContent = '? Rate this track:  L = like   D = dislike   N = normal'
  e.style.display = 'block'
}

export function hideRateNudge(): void {
  if (el) el.style.display = 'none'
}
