import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/**
 * Drag the Tauri window when clicking on non-interactive Webamp areas.
 * Prevents Webamp's internal window dragging by calling preventDefault.
 */
export function setupWindowDrag() {
  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    if (isInteractive(target)) return;

    e.preventDefault();
    appWindow.startDragging();
  });
}

/**
 * Auto-resize Tauri window to tightly fit Webamp content.
 * Polls on startup, then watches for layout changes via MutationObserver.
 */
export function setupAutoResize() {
  let resizeTimer: number | null = null;
  let lastWidth = 0;
  let lastHeight = 0;

  function resizeToContent() {
    const webampEl = document.getElementById("webamp");
    if (!webampEl) return;

    const windows = webampEl.querySelectorAll("[id$='-window']");
    if (windows.length === 0) return;

    let maxRight = 0;
    let maxBottom = 0;

    windows.forEach((win) => {
      const el = win as HTMLElement;
      const wrapper = el.closest("[style*='translate']") as HTMLElement | null;
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      maxRight = Math.max(maxRight, rect.left + rect.width);
      maxBottom = Math.max(maxBottom, rect.top + rect.height);
    });

    if (maxRight > 0 && maxBottom > 0) {
      const w = Math.ceil(maxRight);
      const h = Math.ceil(maxBottom);

      // Only resize if dimensions actually changed
      if (w !== lastWidth || h !== lastHeight) {
        lastWidth = w;
        lastHeight = h;
        appWindow.setSize(new LogicalSize(w, h));
      }
    }
  }

  function debouncedResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resizeToContent, 50);
  }

  // Poll until content renders
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    resizeToContent();
    if (lastWidth > 0 || attempts > 30) {
      clearInterval(poll);
    }
  }, 100);

  // Watch for layout changes
  const webampEl = document.getElementById("webamp");
  if (webampEl) {
    const observer = new MutationObserver(debouncedResize);
    observer.observe(webampEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }
}

function isInteractive(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  while (current) {
    const tag = current.tagName.toLowerCase();
    const cls = typeof current.className === "string" ? current.className : "";

    if (["button", "input", "select", "textarea", "a"].includes(tag)) return true;

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
