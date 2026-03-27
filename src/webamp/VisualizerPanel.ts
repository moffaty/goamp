import {
  addCustomPresetFromFile,
  removeCustomPreset,
  listCustomPresets,
} from "./butterchurn";
import type Webamp from "webamp";

let panel: HTMLDivElement | null = null;
let webampInstance: Webamp | null = null;

export function initVisualizerPanel(webamp: Webamp) {
  webampInstance = webamp;
}

export function toggleVisualizerPanel() {
  if (panel) {
    panel.remove();
    panel = null;
  } else {
    openPanel();
  }
}

function openPanel() {
  panel = document.createElement("div");
  panel.id = "visualizer-panel";
  panel.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 480px; max-height: 70vh; background: #1a1a2e; border: 2px solid #444;
    border-radius: 8px; color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
    font-size: 11px; z-index: 11000; display: flex; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.9);
  `;

  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444; border-radius:6px 6px 0 0;">
      <span style="font-weight:bold; color:#fc0;">Visualizer Presets</span>
      <button id="viz-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div style="padding:10px; overflow-y:auto; flex:1;">
      <div style="margin-bottom:10px; padding:8px; background:#111; border:1px solid #333; border-radius:4px;">
        <div style="color:#aaa; margin-bottom:6px; font-size:10px;">
          Add custom presets — Butterchurn JSON format (<a href="https://github.com/jberg/butterchurn-presets" style="color:#88f;">butterchurn-presets</a>, <a href="https://github.com/jberg/milkdrop-preset-converter" style="color:#88f;">converter</a>)
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="file" id="viz-file-input" accept=".json" multiple style="display:none;" />
          <button id="viz-add-btn" style="padding:5px 12px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">
            + Add JSON preset(s)
          </button>
          <span id="viz-add-status" style="color:#888; font-size:10px;"></span>
        </div>
      </div>
      <div style="margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#aaa; font-size:10px;">CUSTOM PRESETS</span>
        <button id="viz-reload-btn" style="padding:2px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:2px;">Reload visualizer</button>
      </div>
      <div id="viz-preset-list"></div>
    </div>
  `;

  document.body.appendChild(panel);
  renderPresetList();

  panel.querySelector("#viz-close")!.addEventListener("click", toggleVisualizerPanel);

  const fileInput = panel.querySelector("#viz-file-input") as HTMLInputElement;
  panel.querySelector("#viz-add-btn")!.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    const status = panel?.querySelector("#viz-add-status") as HTMLElement;
    if (!files.length) return;

    let added = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await addCustomPresetFromFile(file);
        added++;
      } catch (e) {
        failed++;
        console.error("[GOAMP] Failed to add preset:", file.name, e);
      }
    }

    if (status) {
      status.textContent = `Added ${added}${failed ? `, ${failed} failed` : ""}`;
      status.style.color = failed ? "#f80" : "#0f0";
    }
    fileInput.value = "";
    renderPresetList();
  });

  panel.querySelector("#viz-reload-btn")!.addEventListener("click", () => {
    reloadVisualizer();
  });
}

function renderPresetList() {
  const list = panel?.querySelector("#viz-preset-list");
  if (!list) return;

  const names = listCustomPresets();

  if (names.length === 0) {
    list.innerHTML = `<div style="color:#444; padding:8px; font-size:10px;">No custom presets. Add JSON files above.</div>`;
    return;
  }

  list.innerHTML = names
    .map(
      (name) => `
    <div class="viz-preset-row" data-name="${escapeAttr(name)}" style="display:flex; align-items:center; padding:4px 6px; border-bottom:1px solid #222; gap:6px;">
      <span style="flex:1; color:#0f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
      <button class="viz-apply-btn" data-name="${escapeAttr(name)}" style="padding:2px 6px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-size:10px; border-radius:2px;">Apply</button>
      <button class="viz-del-btn" data-name="${escapeAttr(name)}" style="padding:2px 5px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:2px;">✕</button>
    </div>
  `,
    )
    .join("");

  list.querySelectorAll(".viz-apply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn as HTMLElement).dataset.name!;
      applyPresetByName(name);
      // Visual feedback
      (btn as HTMLElement).textContent = "✓";
      (btn as HTMLElement).style.color = "#0f0";
      setTimeout(() => {
        (btn as HTMLElement).textContent = "Apply";
        (btn as HTMLElement).style.color = "#fc0";
      }, 1500);
    });
  });

  list.querySelectorAll(".viz-del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn as HTMLElement).dataset.name!;
      removeCustomPreset(name);
      renderPresetList();
    });
  });
}

function applyPresetByName(name: string) {
  if (!webampInstance) return;
  const store = (webampInstance as any).store;
  if (!store) return;

  const state = store.getState();
  const presets: Array<{ name: string }> = state?.milkdrop?.presets || [];
  const idx = presets.findIndex((p) => p.name === name);

  if (idx >= 0) {
    store.dispatch({ type: "SET_MILKDROP_PRESET", presetName: name });
    console.log(`[GOAMP] Applied preset: ${name}`);
  } else {
    console.warn(`[GOAMP] Preset not found in store: ${name}. Reload required.`);
  }
}

function reloadVisualizer() {
  // Force Webamp to reload the visualizer by toggling Milkdrop window
  if (!webampInstance) return;
  const store = (webampInstance as any).store;
  if (!store) return;

  // Close and reopen milkdrop to force getPresets() to re-run with new custom presets
  store.dispatch({ type: "CLOSE_MILKDROP_WINDOW" });
  setTimeout(() => {
    store.dispatch({ type: "OPEN_MILKDROP_WINDOW" });
  }, 100);

  // Close panel — user needs to reopen Milkdrop
  setTimeout(() => {
    if (panel) {
      const status = panel.querySelector("#viz-add-status") as HTMLElement;
      if (status) {
        status.textContent = "Reloaded. Open Milkdrop to see new presets.";
        status.style.color = "#0f0";
      }
    }
  }, 200);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
