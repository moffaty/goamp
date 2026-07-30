/**
 * Retro Winamp-style window chrome + pixel icon pack for GOAMP dynamic panels.
 *
 * Panels register bare DOM (`ctx.ui.registerPanel`); PanelHost wraps each in a
 * `retroWindow()` so every panel gets an authentic beveled title bar, draggable
 * header and a pixel close button — without each feature reinventing chrome.
 */

// ── Pixel icon pack (inline SVG, no assets) ──────────────────────────────────
// 8×8 crisp-edges glyphs. Grows as consumers appear — only what's used ships.
const ICONS: Record<string, string> = {
  // classic Winamp titlebar close: an X in the corner.
  close:
    '<svg viewBox="0 0 8 8" width="8" height="8" shape-rendering="crispEdges" fill="#c8c8ff">' +
    '<rect x="1" y="1" width="1" height="1"/><rect x="6" y="1" width="1" height="1"/>' +
    '<rect x="2" y="2" width="1" height="1"/><rect x="5" y="2" width="1" height="1"/>' +
    '<rect x="3" y="3" width="2" height="2"/>' +
    '<rect x="2" y="5" width="1" height="1"/><rect x="5" y="5" width="1" height="1"/>' +
    '<rect x="1" y="6" width="1" height="1"/><rect x="6" y="6" width="1" height="1"/></svg>',
}

/** Returns the inline SVG markup for a pixel icon, or '' if unknown. */
export function retroIcon(name: keyof typeof ICONS | string): string {
  return ICONS[name] ?? ''
}

/** 'p2p-peers' → 'P2P Peers'. Best-effort prettify for titlebars. */
export function prettifyPanelId(id: string): string {
  const acronyms = new Set(['p2p', 'ui'])
  return id
    .split(/[-_]/)
    .map((w) => (acronyms.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * Wraps `body` in a retro Winamp window frame. The returned element carries the
 * title bar (draggable, moves `dragTarget`) and a close button (calls onClose).
 * `dragTarget` is the positioned container PanelHost mounts (defaults to the
 * frame itself if the frame is positioned).
 */
export function retroWindow(
  opts: { title: string; onClose: () => void; dragTarget?: HTMLElement },
  body: HTMLElement,
): HTMLElement {
  const win = document.createElement('div')
  win.className = 'goamp-retro-window'
  win.style.cssText =
    'background:#232438;border:2px outset #6a6a9a;box-shadow:2px 2px 0 rgba(0,0,0,0.5);' +
    'font-family:monospace;min-width:180px;'

  const bar = document.createElement('div')
  bar.className = 'goamp-retro-titlebar'
  bar.style.cssText =
    'display:flex;align-items:center;height:18px;padding:0 4px;cursor:move;user-select:none;' +
    'background:linear-gradient(180deg,#4b4b7a,#2a2a44);border-bottom:1px solid #14142a;'

  const titleEl = document.createElement('span')
  titleEl.className = 'goamp-retro-title'
  titleEl.textContent = opts.title
  titleEl.style.cssText = 'flex:1;color:#c8c8ff;font-size:11px;font-weight:bold;letter-spacing:1px;'
  bar.appendChild(titleEl)

  const close = document.createElement('button')
  close.className = 'goamp-retro-close'
  close.setAttribute('aria-label', 'Close')
  close.innerHTML = retroIcon('close')
  close.style.cssText =
    'width:12px;height:12px;padding:0;display:flex;align-items:center;justify-content:center;' +
    'background:#2a2a44;border:1px outset #6a6a9a;cursor:pointer;line-height:0;'
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    opts.onClose()
  })
  bar.appendChild(close)

  win.appendChild(bar)
  win.appendChild(body)

  // Drag the whole window by its title bar.
  const target = opts.dragTarget ?? win
  bar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    const rect = target.getBoundingClientRect()
    const offX = e.clientX - rect.left
    const offY = e.clientY - rect.top
    const move = (ev: MouseEvent) => {
      target.style.left = `${ev.clientX - offX}px`
      target.style.top = `${ev.clientY - offY}px`
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })

  return win
}
