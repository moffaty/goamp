import { getCurrentWindow } from "@tauri-apps/api/window";

export function setupWindowDrag() {
  const appWindow = getCurrentWindow();

  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;

    // Webamp title bar has class "title-bar" inside "#main-window"
    // Also handle the title bars of EQ and playlist windows
    if (isTitleBar(target)) {
      e.preventDefault();
      appWindow.startDragging();
    }
  });
}

function isTitleBar(el: HTMLElement): boolean {
  // Walk up from target to check if we're in a draggable title bar area
  let current: HTMLElement | null = el;
  while (current) {
    const id = current.id;
    const cls = current.className;

    // Webamp title bar areas — these are the drag handles in classic Winamp skin
    if (typeof cls === "string" && cls.includes("title-bar")) {
      return true;
    }

    // Webamp uses specific IDs for window chrome
    if (id === "title-bar") {
      return true;
    }

    current = current.parentElement;
  }
  return false;
}
