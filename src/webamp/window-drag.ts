import { getCurrentWindow } from "@tauri-apps/api/window";

export function setupWindowDrag() {
  const appWindow = getCurrentWindow();

  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;

    // Don't drag if clicking on interactive elements
    if (isInteractive(target)) return;

    // Allow dragging from any non-interactive area (title bars, empty space, etc.)
    e.preventDefault();
    appWindow.startDragging();
  });
}

function isInteractive(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  while (current) {
    const tag = current.tagName.toLowerCase();
    const cls = typeof current.className === "string" ? current.className : "";

    // Standard interactive elements
    if (["button", "input", "select", "textarea", "a"].includes(tag)) return true;

    // Webamp sliders, buttons, and controls
    if (
      cls.includes("slider") ||
      cls.includes("button") ||
      cls.includes("volume") ||
      cls.includes("balance") ||
      cls.includes("position") ||
      cls.includes("seek") ||
      cls.includes("eject") ||
      cls.includes("close") ||
      cls.includes("minimize") ||
      cls.includes("shade") ||
      cls.includes("clutterbar") ||
      cls.includes("playlist-tracks") ||
      cls.includes("visualizer")
    ) {
      return true;
    }

    current = current.parentElement;
  }
  return false;
}
