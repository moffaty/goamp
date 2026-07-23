/**
 * Small on-screen status line for the infinite-playlist (Autoplay) feature.
 *
 * Production builds have no devtools, so without this the user cannot tell
 * whether autoplay is enabled, working, or silently failing. Every refill
 * cycle reports here.
 */

let el: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function ensureEl(): HTMLElement {
  // Re-create when the cached reference has been detached from the DOM.
  if (el && el.isConnected) return el
  el = document.createElement('div')
  el.id = 'goamp-autoplay-status'
  Object.assign(el.style, {
    position: 'fixed',
    left: '6px',
    bottom: '6px',
    background: 'rgba(0, 0, 0, 0.85)',
    color: '#00ff88',
    font: '11px/1.4 monospace',
    padding: '4px 9px',
    borderRadius: '3px',
    border: '1px solid #00ff88',
    zIndex: '999990',
    pointerEvents: 'none',
    maxWidth: '340px',
  })
  document.body.appendChild(el)
  return el
}

/**
 * Show an autoplay status message. `sticky` keeps it visible (e.g. while a
 * refill is in progress); otherwise it auto-hides after a few seconds.
 */
export function showAutoplayStatus(text: string, sticky = false): void {
  const e = ensureEl()
  e.textContent = `♪ Autoplay — ${text}`
  e.style.display = 'block'
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (!sticky) {
    hideTimer = setTimeout(() => {
      if (el) el.style.display = 'none'
    }, 5000)
  }
}

export function hideAutoplayStatus(): void {
  if (el) el.style.display = 'none'
}
