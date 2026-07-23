import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

const appWindow = getCurrentWindow();

// Transparent container elements that fill the window but render no UI of
// their own. elementFromPoint returns these when the cursor is over an empty
// gap — clicks there must pass through to whatever is behind the window.
const PASSTHROUGH_IDS = new Set(["app", "webamp"]);

/**
 * True if `el` is real Webamp/overlay UI that should capture clicks. The
 * transparent containers (body, html, #app mount div, #webamp positioning
 * root) are NOT content — clicks over them pass through.
 */
export function isAppContent(el: Element | null): boolean {
  if (el === null) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (PASSTHROUGH_IDS.has((el as HTMLElement).id)) return false;
  return true;
}

/**
 * Click-through for the transparent parts of the window.
 *
 * The empty space around Webamp's panels is transparent — clicks there should
 * pass through to the desktop / windows behind. We poll the global cursor
 * position (native GetCursorPos — reliable, no flaky low-level hook) and
 * toggle setIgnoreCursorEvents based on whether the cursor sits over real UI.
 *
 * Polling (not a hook) self-corrects every frame, so the window can never get
 * stuck either click-through or capturing.
 *
 * Returns a stop function.
 */
export function setupClickThrough(): () => void {
  let winX: number | null = null;
  let winY: number | null = null;
  let ignored: boolean | null = null;
  let trueRatio = window.devicePixelRatio || 1;
  let stopped = false;

  const refreshWinPos = () => {
    appWindow
      .outerPosition()
      .then((p) => {
        winX = p.x;
        winY = p.y;
      })
      .catch(() => {
        winX = window.screenX;
        winY = window.screenY;
      });
  };
  refreshWinPos();
  appWindow.listen("tauri://move", refreshWinPos).catch(() => {});
  appWindow.listen("tauri://resize", refreshWinPos).catch(() => {});

  // --force-device-scale-factor=1 makes devicePixelRatio report 1 even on
  // HiDPI. innerSize (physical) / innerWidth (CSS) gives the real ratio.
  appWindow
    .innerSize()
    .then((s) => {
      if (window.innerWidth > 0) trueRatio = s.width / window.innerWidth;
    })
    .catch(() => {});

  const tick = async () => {
    if (stopped) return;
    try {
      const [px, py] = await invoke<[number, number]>("cursor_position");
      if (winX !== null && winY !== null) {
        const cssX = (px - winX) / trueRatio;
        const cssY = (py - winY) / trueRatio;
        const inBounds =
          cssX >= 0 && cssX < window.innerWidth && cssY >= 0 && cssY < window.innerHeight;
        if (inBounds) {
          const shouldIgnore = !isAppContent(document.elementFromPoint(cssX, cssY));
          if (shouldIgnore !== ignored) {
            appWindow.setIgnoreCursorEvents(shouldIgnore).catch(() => {});
            ignored = shouldIgnore;
          }
        }
      }
    } catch {
      /* cursor_position unavailable — leave the window clickable */
    }
    if (!stopped) setTimeout(tick, 24); // ~40 fps
  };
  void tick();

  // Safety net: if the webview receives a real mouse event we are definitely
  // NOT over a transparent gap — make sure the window is capturing.
  const onMove = () => {
    if (ignored) {
      appWindow.setIgnoreCursorEvents(false).catch(() => {});
      ignored = false;
    }
  };
  document.addEventListener("mousemove", onMove);

  return () => {
    stopped = true;
    document.removeEventListener("mousemove", onMove);
  };
}

/**
 * Make Webamp title bars draggable OS windows via Tauri's drag-region API.
 * Runs after Webamp renders so the DOM elements exist.
 */
export function setupWindowDrag() {
  const applyDragRegions = () => {
    document.querySelectorAll<HTMLElement>("#webamp .title-bar").forEach((el) => {
      el.dataset.tauriDragRegion = "";
    });
  };

  applyDragRegions();

  const observer = new MutationObserver(applyDragRegions);
  const webampEl = document.getElementById("webamp");
  if (webampEl) {
    observer.observe(webampEl, { childList: true, subtree: true });
  }
}
