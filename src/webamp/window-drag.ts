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
export function setupClickThrough() {
  let isIgnored: boolean | null = null;

  appWebview.listen<{ x: number; y: number }>(
    "device-mouse-move",
    ({ payload }) => {
      // rdev gives device pixels, DOM uses CSS pixels
      const ratio = window.devicePixelRatio || 1;
      const cssX = payload.x / ratio;
      const cssY = payload.y / ratio;

      const el = document.elementFromPoint(cssX, cssY);
      const inContent = el !== null && isAppContent(el as HTMLElement);

      const shouldIgnore = !inContent;

      if (shouldIgnore !== isIgnored) {
        appWindow.setIgnoreCursorEvents(shouldIgnore);
        isIgnored = shouldIgnore;
      }
    }
  );

  // When WebView receives any mouse event, ensure ignore is off.
  // This catches edge cases like context menus appearing under cursor.
  document.addEventListener("mousemove", () => {
    if (isIgnored) {
      appWindow.setIgnoreCursorEvents(false);
      isIgnored = false;
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
 * No-op: Webamp handles its own internal window dragging.
 */
export function setupWindowDrag() {}
