/**
 * One-time onboarding card shown the first time the user enables Autoplay.
 * Explains the L / D / N rating hotkeys. Dismissed via the button or by
 * pressing one of those keys. Persistence flag is in localStorage so it
 * never re-appears.
 */

const ONBOARDED_KEY = 'autoplay:onboarded'
const OVERLAY_ID = 'goamp-autoplay-onboarding'

const KBD_STYLE =
  'background:#222;border:1px solid #555;border-radius:3px;padding:1px 7px;' +
  'font-family:monospace;color:#0f0;font-size:11px;margin-right:6px'
const BTN_STYLE =
  'background:#0a0;color:#fff;border:none;padding:6px 14px;border-radius:3px;' +
  'cursor:pointer;font-family:inherit;font-size:12px'

/** Show the onboarding once. Subsequent calls are no-ops. */
export function showOnboardingOnce(): void {
  if (localStorage.getItem(ONBOARDED_KEY) === '1') return
  if (document.getElementById(OVERLAY_ID)) return
  render()
}

function render(): void {
  const card = document.createElement('div')
  card.id = OVERLAY_ID
  Object.assign(card.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(20, 20, 30, 0.96)',
    color: '#fff',
    fontFamily: '"MS Sans Serif", Tahoma, sans-serif',
    fontSize: '12px',
    padding: '18px 22px',
    borderRadius: '4px',
    border: '1px solid #4a4',
    zIndex: '999995',
    maxWidth: '380px',
    lineHeight: '1.55',
    boxShadow: '0 4px 22px rgba(0,0,0,0.6)',
  })

  card.innerHTML = `
    <div style="font-weight:bold;color:#0f0;margin-bottom:8px;font-size:13px">♪ Autoplay is on</div>
    <div style="margin-bottom:12px">
      The queue auto-fills with similar tracks. Help GOAMP learn your taste —
      rate the playing track with one key:
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
      <div><kbd style="${KBD_STYLE}">L</kbd>like — we'll prefer similar tracks</div>
      <div><kbd style="${KBD_STYLE}">D</kbd>dislike — this track won't come back</div>
      <div><kbd style="${KBD_STYLE}">N</kbd>normal — no opinion (silences the rate prompt)</div>
    </div>
    <div style="opacity:0.75;margin-bottom:12px;font-size:11px">
      Every few tracks we'll prompt you to rate the current one if you haven't.
    </div>
    <button id="${OVERLAY_ID}-ok" style="${BTN_STYLE}">Got it</button>
  `

  card.querySelector(`#${OVERLAY_ID}-ok`)?.addEventListener('click', () => dismissOnboarding())
  document.body.appendChild(card)
}

/** Mark onboarding as seen and remove the overlay (if present). */
export function dismissOnboarding(): void {
  localStorage.setItem(ONBOARDED_KEY, '1')
  document.getElementById(OVERLAY_ID)?.remove()
}

/** True when the user has seen and dismissed the onboarding card. */
export function isOnboarded(): boolean {
  return localStorage.getItem(ONBOARDED_KEY) === '1'
}
