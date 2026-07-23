import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Window z-order controls.
 *
 *  - On-Top    — a PERSISTENT toggle. Keeps the window above all others
 *                (setAlwaysOnTop). Saved and restored across sessions.
 *  - To-Bottom — a ONE-SHOT action. A native SetWindowPos(HWND_BOTTOM) drops
 *                the window behind the others once. It stays a normal,
 *                clickable window — clicking or Alt-Tab brings it forward.
 *                Nothing is persisted, so it can never leave the window stuck.
 */

const ON_TOP_KEY = "goamp_on_top";

/** Whether the persistent On-Top toggle is active. */
export function isOnTop(): boolean {
  const v = localStorage.getItem(ON_TOP_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  // Migrate legacy keys from older builds.
  return (
    localStorage.getItem("goamp_always_on_top") === "1" ||
    localStorage.getItem("goamp_window_layer") === "top"
  );
}

/** Toggle the persistent On-Top mode. */
export function setOnTop(on: boolean): void {
  localStorage.setItem(ON_TOP_KEY, on ? "1" : "0");
  getCurrentWindow().setAlwaysOnTop(on).catch(() => {});
}

/** Restore the On-Top toggle on startup. */
export function applyOnTop(): void {
  getCurrentWindow().setAlwaysOnTop(isOnTop()).catch(() => {});
}

/**
 * Send the window to the back of the z-order — ONE-SHOT. Clears On-Top first
 * (a window can't be both pinned on top and sent to the back). Delegates to
 * the native window_send_to_back command (SetWindowPos), NOT setAlwaysOnBottom,
 * so the window stays clickable and nothing is persisted.
 */
export async function sendToBack(): Promise<void> {
  if (isOnTop()) setOnTop(false);
  await invoke("window_send_to_back").catch(() => {});
}
