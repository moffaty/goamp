import {
  addCustomPresetFromFile,
  removeCustomPreset,
  listCustomPresets,
} from "./butterchurn";
import { escapeHtml } from "../lib/ui-utils";
import type Webamp from "webamp";
import type { PlayerStore } from "../player/PlayerStore";

let panel: HTMLDivElement | null = null;
let webampInstance: Webamp | null = null;
let storeInstance: PlayerStore | null = null;
let currentFilter = "";

export function initVisualizerPanel(webamp: Webamp, store: PlayerStore) {
  webampInstance = webamp;
  storeInstance = store;
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
    width: 520px; max-height: 75vh; background: #1a1a2e; border: 2px solid #444;
    border-radius: 8px; color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
    font-size: 11px; z-index: 11000; display: flex; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.9);
  `;

  const allPresets = storeInstance?.getMilkdropPresets() ?? [];
  const customNames = new Set(listCustomPresets());

  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444; border-radius:6px 6px 0 0;">
      <span style="font-weight:bold; color:#fc0;">Visualizer Presets</span>
      <button id="viz-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div style="padding:8px 10px; border-bottom:1px solid #333; display:flex; gap:6px; align-items:center;">
      <input id="viz-search" type="text" placeholder="Search presets… (${allPresets.length} total)" value="${escapeHtml(currentFilter)}"
        style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
      <button id="viz-reload-btn" style="padding:4px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:2px; white-space:nowrap;">Reload viz</button>
    </div>
    <div style="padding:6px 10px; border-bottom:1px solid #333; display:flex; gap:6px; align-items:center;">
      <input type="file" id="viz-file-input" accept=".json" multiple style="display:none;" />
      <button id="viz-add-btn" style="padding:4px 10px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">
        + Add custom preset
      </button>
      <span id="viz-add-status" style="color:#888; font-size:10px;"></span>
    </div>
    <div id="viz-preset-list" style="overflow-y:auto; flex:1;"></div>
  `;

  document.body.appendChild(panel);
  renderPresetList(allPresets, customNames);

  panel.querySelector("#viz-close")!.addEventListener("click", toggleVisualizerPanel);

  const searchInput = panel.querySelector("#viz-search") as HTMLInputElement;
  searchInput.addEventListener("input", () => {
    currentFilter = searchInput.value;
    renderPresetList(storeInstance?.getMilkdropPresets() ?? [], customNames);
  });
  searchInput.focus();

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
    const updatedCustomNames = new Set(listCustomPresets());
    renderPresetList(storeInstance?.getMilkdropPresets() ?? [], updatedCustomNames);
  });

  panel.querySelector("#viz-reload-btn")!.addEventListener("click", () => {
    reloadVisualizer();
  });
}

function renderPresetList(allPresets: string[], customNames: Set<string>) {
  const list = panel?.querySelector("#viz-preset-list");
  if (!list) return;

  const filter = currentFilter.toLowerCase();
  const filtered = allPresets
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !filter || name.toLowerCase().includes(filter));

  const customFiltered = listCustomPresets().filter(
    (name) => !filter || name.toLowerCase().includes(filter)
  );

  // Custom presets (with remove button)
  const customRows = customFiltered.map((name) => {
    const inBuiltin = allPresets.findIndex((n) => n === name);
    const idx = inBuiltin >= 0 ? inBuiltin : -1;
    return `
      <div class="viz-preset-row" data-name="${escapeAttr(name)}" data-index="${idx}" data-custom="1"
        style="display:flex; align-items:center; padding:3px 8px; border-bottom:1px solid #1a1a2e; gap:6px; background:#16162a;">
        <span style="flex:1; color:#fc0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(name)}">★ ${escapeHtml(name)}</span>
        <button class="viz-del-btn" data-name="${escapeAttr(name)}" style="padding:1px 5px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:2px;">✕</button>
      </div>`;
  });

  // Built-in presets (excluding ones already listed as custom)
  const builtinRows = filtered
    .filter(({ name }) => !customNames.has(name))
    .map(({ name, index }) => `
      <div class="viz-preset-row" data-name="${escapeAttr(name)}" data-index="${index}"
        style="display:flex; align-items:center; padding:3px 8px; border-bottom:1px solid #1a1a2e; gap:6px;">
        <span style="flex:1; color:#0f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
      </div>`);

  if (customRows.length === 0 && builtinRows.length === 0) {
    list.innerHTML = `<div style="color:#444; padding:12px; font-size:10px; text-align:center;">No presets match "${escapeHtml(filter)}"</div>`;
    return;
  }

  if (allPresets.length === 0) {
    list.innerHTML = `<div style="color:#444; padding:12px; font-size:10px; text-align:center;">Open Milkdrop first (Ctrl+V) to load presets.</div>`;
    return;
  }

  list.innerHTML = customRows.join("") + builtinRows.join("");

  list.querySelectorAll<HTMLElement>(".viz-preset-row").forEach((row) => {
    row.addEventListener("mouseenter", () => { row.style.background = "#2a2a40"; });
    row.addEventListener("mouseleave", () => { row.style.background = row.dataset.custom ? "#16162a" : ""; });
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("viz-del-btn")) return;
      const idx = parseInt(row.dataset.index ?? "-1", 10);
      if (idx >= 0 && storeInstance) {
        storeInstance.selectMilkdropPreset(idx);
        // Visual feedback
        const span = row.querySelector("span")!;
        const orig = span.style.color;
        span.style.color = "#fc0";
        setTimeout(() => { span.style.color = orig; }, 600);
      }
    });
  });

  list.querySelectorAll<HTMLElement>(".viz-del-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.name!;
      removeCustomPreset(name);
      const updatedCustomNames = new Set(listCustomPresets());
      renderPresetList(storeInstance?.getMilkdropPresets() ?? [], updatedCustomNames);
    });
  });
}

function reloadVisualizer() {
  if (!webampInstance) return;
  const store = (webampInstance as any).store;
  if (!store) return;

  // Close and reopen milkdrop to force getPresets() to re-run with new custom presets
  store.dispatch({ type: "ENABLE_MILKDROP", open: false });
  setTimeout(() => {
    store.dispatch({ type: "ENABLE_MILKDROP", open: true });
    // Restore correct position — ENABLE_MILKDROP resets it to {x:0,y:0}
    store.dispatch({ type: "UPDATE_WINDOW_POSITIONS", positions: { milkdrop: { x: 275, y: 0 } }, absolute: true });
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

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
