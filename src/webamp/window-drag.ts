import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

export function setupWindowDrag() {
  const appWindow = getCurrentWindow();

  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;

    if (isInteractive(target)) return;

    e.preventDefault();
    appWindow.startDragging();
  });
}

export function setupAutoResize() {
  const appWindow = getCurrentWindow();

  function resizeToContent() {
    // Find all Webamp windows and calculate bounding box
    const webampWindows = document.querySelectorAll(
      "#webamp [id$='-window']"
    );

    if (webampWindows.length === 0) return;

    let maxRight = 0;
    let maxBottom = 0;

    webampWindows.forEach((win) => {
      const el = win as HTMLElement;
      if (el.offsetParent === null) return; // hidden
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    });

    if (maxRight > 0 && maxBottom > 0) {
      appWindow.setSize(new LogicalSize(
        Math.ceil(maxRight),
        Math.ceil(maxBottom)
      ));
    }
  }

  // Resize on load and when Webamp layout changes
  resizeToContent();
  setTimeout(resizeToContent, 500);
  setTimeout(resizeToContent, 1500);

  // Watch for DOM changes (Webamp opening/closing windows)
  const observer = new MutationObserver(() => {
    setTimeout(resizeToContent, 100);
  });

  const webampEl = document.getElementById("webamp");
  if (webampEl) {
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
