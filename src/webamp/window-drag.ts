import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const appWindow = getCurrentWindow();
const appWebview = getCurrentWebviewWindow();

/**
 * Click-through: transparent areas pass clicks to windows behind.
 * Rust (rdev) tracks global mouse position and emits events even when
 * the window ignores cursor events. Frontend toggles ignore on/off
 * based on whether the cursor is over Webamp content.
 */
// Module-level state so resetClickThrough() can reach them.
let _isIgnored: boolean | null = null;
let _refreshWinPos: (() => void) | null = null;

/**
 * Call after programmatic window resize so the cached cursor state and
 * window position are reset. Prevents setIgnoreCursorEvents getting stuck.
 */
export function resetClickThrough(): void {
  _isIgnored = null;
  appWindow.setIgnoreCursorEvents(false).catch(() => {});
  _refreshWinPos?.();
}

export function setupClickThrough() {
  // Use window.screenX/Y as synchronous initial value (works on Windows/WebView2).
  // On Linux/WebKitGTK screenX may be 0, so also fetch via outerPosition() and
  // keep updated on window move events.
  let winScreenX = window.screenX;
  let winScreenY = window.screenY;

  const refreshWinPos = () => {
    appWindow.outerPosition().then((pos) => {
      winScreenX = pos.x;
      winScreenY = pos.y;
    }).catch(() => {
      // outerPosition unavailable — keep window.screenX as fallback
      winScreenX = window.screenX;
      winScreenY = window.screenY;
    });
  };
  _refreshWinPos = refreshWinPos;

  refreshWinPos();
  appWindow.listen("tauri://move", refreshWinPos).catch(() => {});

  appWebview.listen<{ x: number; y: number }>(
    "device-mouse-move",
    ({ payload }) => {
      // rdev gives global screen physical pixels; convert to viewport CSS coords.
      // outerPosition() also returns physical pixels. With --force-device-scale-factor=1
      // the ratio is 1, but we still apply it for correctness.
      const ratio = window.devicePixelRatio || 1;
      const cssX = (payload.x - winScreenX) / ratio;
      const cssY = (payload.y - winScreenY) / ratio;

      const el = document.elementFromPoint(cssX, cssY);
      const inContent = el !== null && isAppContent(el as HTMLElement);

      const shouldIgnore = !inContent;

      if (shouldIgnore !== _isIgnored) {
        appWindow.setIgnoreCursorEvents(shouldIgnore);
        _isIgnored = shouldIgnore;
      }
    }
  );

  // When WebView receives any mouse event, ensure ignore is off.
  // This catches edge cases like context menus appearing under cursor.
  document.addEventListener("mousemove", () => {
    if (_isIgnored) {
      appWindow.setIgnoreCursorEvents(false);
      _isIgnored = false;
    }
  });
}

function isAppContent(el: HTMLElement): boolean {
  // Generic rule: transparent background (body/html) = click-through.
  // Any actual UI element (Webamp, overlays, menus, etc.) captures clicks.
  if (el === document.body || el === document.documentElement) return false;
  return true;
}

/**
 * Make Webamp title bars draggable OS windows via Tauri's drag-region API.
 * Runs after Webamp renders so the DOM elements exist.
 */
export function setupWindowDrag() {
  // Webamp uses class "title-bar" for all draggable title areas.
  // We also re-apply when the DOM changes (e.g. skin change) via MutationObserver.
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
