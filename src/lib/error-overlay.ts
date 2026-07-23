/**
 * Visible error overlay for production builds without devtools.
 * Renders a draggable, copyable error panel directly in the DOM when something
 * during startup throws or rejects. Critical on Windows production builds
 * where the user has no console access.
 */
export function showErrorOverlay(title: string, err: unknown): void {
  const message = err instanceof Error
    ? `${err.name}: ${err.message}\n\n${err.stack ?? '(no stack)'}`
    : String(err)

  const existing = document.getElementById('goamp-error-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'goamp-error-overlay'
  // Use individual style properties so jsdom (and inspectors) can see them.
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    background: 'rgba(20, 0, 0, 0.95)',
    color: '#ff8080',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '16px',
    overflow: 'auto',
    zIndex: '999999',
    whiteSpace: 'pre-wrap',
    userSelect: 'text',
  })

  const titleEl = document.createElement('div')
  titleEl.textContent = title
  titleEl.style.cssText = 'color: #ff4040; font-weight: bold; margin-bottom: 8px; font-size: 13px'

  const body = document.createElement('div')
  body.textContent = message

  const dismiss = document.createElement('button')
  dismiss.textContent = 'dismiss'
  dismiss.style.cssText = 'margin-top: 12px; padding: 4px 12px; background: #400; color: #fff; border: 1px solid #800; cursor: pointer'
  dismiss.onclick = () => overlay.remove()

  overlay.appendChild(titleEl)
  overlay.appendChild(body)
  overlay.appendChild(dismiss)
  document.body.appendChild(overlay)
}

/**
 * Install global handlers so any uncaught error/rejection during runtime
 * (not just startup) becomes visible.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    showErrorOverlay('Uncaught error', e.error ?? e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    showErrorOverlay('Unhandled promise rejection', e.reason)
  })
  // GoampCore dispatches this when a source/feature init throws but core
  // continues running (isolation). Surface to the user without killing the app.
  window.addEventListener('goamp:module-error', (e) => {
    const detail = (e as CustomEvent<{ module: string; error: unknown }>).detail
    showErrorOverlay(`Module init failed: ${detail.module}`, detail.error)
  })
  // <audio>/<video> load failures — these don't bubble, so capture them.
  // This is how a track that won't play surfaces a concrete reason.
  window.addEventListener(
    'error',
    (e) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO')) {
        const m = (el as HTMLMediaElement).error
        const src = (el as HTMLMediaElement).currentSrc || (el as HTMLMediaElement).src || '(none)'
        showErrorOverlay('Track failed to load', `src: ${src}\n\n${mediaErrorText(m)}`)
      }
    },
    true,
  )
}

function mediaErrorText(m: MediaError | null): string {
  if (!m) return 'unknown media error'
  const names: Record<number, string> = {
    1: 'ABORTED — load was aborted',
    2: 'NETWORK — network/protocol error (handler unreachable or it errored)',
    3: 'DECODE — audio could not be decoded (bad content-type or format)',
    4: 'SRC_NOT_SUPPORTED — URL not supported, or the handler returned 4xx/5xx',
  }
  return `MediaError ${m.code}: ${names[m.code] ?? 'unknown'}${m.message ? `\n${m.message}` : ''}`
}
