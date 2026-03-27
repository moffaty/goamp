import type Webamp from "webamp";

let panel: HTMLElement | null = null;
let webampRef: Webamp | null = null;

export function initAudioDevicePanel(webamp: Webamp) {
  webampRef = webamp;
}

export function toggleAudioDevicePanel() {
  if (panel) {
    closePanel();
  } else {
    openPanel();
  }
}

function getSkinColors() {
  const defaults = {
    bg: "#1d2439",
    fg: "#2a3555",
    text: "#00ff00",
    accent: "#ffcc00",
    textBg: "#0a0e1a",
  };
  if (!webampRef) return defaults;
  try {
    const state = (webampRef as any).store?.getState();
    const colors: string[] = state?.display?.skinColors || [];
    if (colors.length >= 5) {
      const bg = colors[3] || defaults.bg;
      const rawText = colors[0] || defaults.text;
      const rawAccent = colors[18] || colors[2] || defaults.accent;
      return {
        bg,
        fg: colors[4] || defaults.fg,
        text: ensureContrast(rawText, bg),
        accent: ensureContrast(rawAccent, bg),
        textBg: colors[1] || defaults.textBg,
      };
    }
  } catch {}
  return defaults;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const rgb = [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function ensureContrast(text: string, bg: string): string {
  const lT = luminance(text);
  const lB = luminance(bg);
  const ratio = (Math.max(lT, lB) + 0.05) / (Math.min(lT, lB) + 0.05);
  if (ratio >= 4.5) return text;
  return lB > 0.4 ? "#000000" : "#ffffff";
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function openPanel() {
  if (panel) return;
  const c = getSkinColors();

  panel = document.createElement("div");
  panel.id = "audio-device-overlay";
  panel.innerHTML = `
    <div class="ad-container" style="background:${c.bg};border-color:${c.fg}">
      <div class="ad-header" style="border-color:${c.fg}">
        <span class="ad-title" style="color:${c.accent}">AUDIO OUTPUT</span>
        <button id="ad-close-btn" style="color:${c.text}">\u00d7</button>
      </div>
      <div id="ad-devices" class="ad-devices"></div>
      <div id="ad-status" class="ad-status" style="color:${c.text};border-color:${c.fg}">
        Select output device
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  injectStyles(c);

  document.getElementById("ad-close-btn")!.addEventListener("click", closePanel);
  panel.addEventListener("click", (e) => {
    if (e.target === panel) closePanel();
  });
  document.addEventListener("keydown", panelKeyHandler);

  await renderDevices(c);
}

function panelKeyHandler(e: KeyboardEvent) {
  if (e.key === "Escape") closePanel();
}

function closePanel() {
  if (panel) {
    panel.classList.add("ad-closing");
    document.removeEventListener("keydown", panelKeyHandler);
    setTimeout(() => {
      panel?.remove();
      panel = null;
    }, 150);
  }
}

async function renderDevices(c: ReturnType<typeof getSkinColors>) {
  const container = document.getElementById("ad-devices");
  const status = document.getElementById("ad-status");
  if (!container) return;

  try {
    // Must request audio permission first — without it, enumerateDevices()
    // returns only "default" with empty labels and obfuscated IDs
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // Permission denied or no mic — still try to enumerate (may get limited list)
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const currentId = localStorage.getItem("goamp_audio_device_id") || "default";

    container.innerHTML = "";

    if (outputs.length === 0) {
      container.innerHTML = `<div style="color:${c.fg};padding:8px;font-size:10px">No output devices found</div>`;
      return;
    }

    for (const device of outputs) {
      const isActive = device.deviceId === currentId ||
        (currentId === "default" && device.deviceId === "");
      const row = document.createElement("div");
      row.className = `ad-row${isActive ? " ad-row-active" : ""}`;
      row.innerHTML = `
        <span class="ad-row-icon" style="color:${isActive ? c.accent : c.fg}">${isActive ? "\u25b6" : "\u25cb"}</span>
        <span class="ad-row-name" style="color:${isActive ? c.accent : c.text}">${escapeHtml(device.label || "Default Device")}</span>
      `;

      row.addEventListener("click", async () => {
        const success = await setAudioDevice(device.deviceId);
        if (success) {
          localStorage.setItem("goamp_audio_device_id", device.deviceId);
          if (status) status.textContent = `Switched to: ${device.label || "Default"}`;
          await renderDevices(c);
        } else {
          if (status) status.textContent = "Failed to switch device";
        }
      });

      container.appendChild(row);
    }

    if (status) status.textContent = `${outputs.length} device${outputs.length > 1 ? "s" : ""} available`;
  } catch (e) {
    container.innerHTML = `<div style="color:red;padding:8px">Error: ${e}</div>`;
  }
}

async function setAudioDevice(deviceId: string): Promise<boolean> {
  try {
    // Find all audio/video elements and set their sink
    const mediaElements = document.querySelectorAll("audio, video");
    for (const el of mediaElements) {
      const mediaEl = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (mediaEl.setSinkId) {
        await mediaEl.setSinkId(deviceId);
      }
    }

    // Also try to find Webamp's internal audio context
    if (webampRef) {
      const store = (webampRef as any).store;
      if (store) {
        const state = store.getState();
        const media = state?.media;
        // Webamp uses an audio element internally
        const audioEl = (media as any)?._audio || document.querySelector("#webamp audio");
        if (audioEl && (audioEl as any).setSinkId) {
          await (audioEl as any).setSinkId(deviceId);
        }
      }
    }

    return true;
  } catch (e) {
    console.error("[GOAMP] Failed to set audio device:", e);
    return false;
  }
}

// Restore saved device on startup
export async function restoreAudioDevice() {
  const deviceId = localStorage.getItem("goamp_audio_device_id");
  if (deviceId && deviceId !== "default") {
    // Wait a bit for Webamp to create its audio element
    setTimeout(() => setAudioDevice(deviceId), 2000);
  }
}

function injectStyles(c: ReturnType<typeof getSkinColors>) {
  const existing = document.getElementById("ad-panel-styles");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "ad-panel-styles";
  style.textContent = `
    @keyframes ad-slide-in {
      from { opacity: 0; transform: translateY(-10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes ad-slide-out {
      from { opacity: 1; }
      to { opacity: 0; transform: scale(0.97); }
    }

    #audio-device-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 30px;
      animation: ad-slide-in 0.2s ease-out;
    }
    #audio-device-overlay.ad-closing {
      animation: ad-slide-out 0.15s ease-in forwards;
    }

    .ad-container {
      width: 340px;
      max-height: 60vh;
      border: 2px solid;
      display: flex;
      flex-direction: column;
      font-family: "MS Sans Serif", "Microsoft Sans Serif", Arial, sans-serif;
      font-size: 11px;
      box-shadow: 1px 1px 0 rgba(255,255,255,0.1) inset, -1px -1px 0 rgba(0,0,0,0.3) inset;
      position: relative;
      overflow: hidden;
    }
    .ad-container::after {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
      pointer-events: none;
    }

    .ad-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      border-bottom: 1px solid;
    }
    .ad-title {
      font-size: 11px;
      letter-spacing: 2px;
      font-weight: bold;
    }
    #ad-close-btn {
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      padding: 0 4px;
    }

    .ad-devices {
      overflow-y: auto;
      flex: 1;
      scrollbar-width: thin;
      scrollbar-color: ${c.fg} ${c.textBg};
    }

    .ad-row {
      display: flex;
      align-items: center;
      padding: 6px 8px;
      cursor: pointer;
      gap: 8px;
      transition: background 0.1s;
    }
    .ad-row:hover { background: rgba(255,255,255,0.06); }
    .ad-row-active { background: rgba(255,255,255,0.1); }
    .ad-row-icon { font-size: 10px; width: 14px; }
    .ad-row-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ad-status {
      padding: 5px 8px;
      font-size: 10px;
      border-top: 1px solid;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
  `;
  document.head.appendChild(style);
}
