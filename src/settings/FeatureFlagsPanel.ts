import {
  featureFlagsList,
  featureFlagsSet,
  refreshFlagCache,
  type FeatureFlag,
} from "./feature-flags-service";
import { escapeHtml } from "../lib/ui-utils";

let panel: HTMLDivElement | null = null;
let visible = false;

export function toggleFeatureFlagsPanel() {
  if (!panel) createPanel();
  visible = !visible;
  panel!.style.display = visible ? "flex" : "none";
  if (visible) loadFlags();
}

function createPanel() {
  panel = document.createElement("div");
  panel.id = "feature-flags-overlay";
  panel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 400px; max-height: 70vh; background: #1a1a2e; border: 2px solid #444; border-radius: 8px;
    color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif; font-size: 11px;
    z-index: 10000; flex-direction: column; padding: 0;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;

  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#fc0;">Feature Flags</span>
      <button id="ff-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div id="ff-list" style="padding: 10px; overflow-y: auto; max-height: calc(70vh - 40px);"></div>
  `;

  document.body.appendChild(panel);
  panel.querySelector("#ff-close")!.addEventListener("click", () => toggleFeatureFlagsPanel());
}

async function loadFlags() {
  const list = panel?.querySelector("#ff-list") as HTMLDivElement;
  if (!list) return;

  try {
    const flags = await featureFlagsList();
    renderFlags(list, flags);
  } catch (e) {
    list.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

function renderFlags(el: HTMLDivElement, flags: FeatureFlag[]) {
  el.innerHTML = flags
    .map(
      (f) => `
      <label data-key="${f.key}" style="display:flex; align-items:center; gap:8px; padding:6px 4px; border-bottom:1px solid #222; cursor:pointer;">
        <input type="checkbox" class="ff-toggle" data-key="${f.key}" ${f.enabled ? "checked" : ""} style="cursor:pointer; accent-color:#0f0;" />
        <div>
          <div style="color:${f.enabled ? "#0f0" : "#666"};">${escapeHtml(f.key)}</div>
          <div style="color:#888; font-size:10px;">${escapeHtml(f.description)}</div>
        </div>
      </label>
    `,
    )
    .join("");

  el.querySelectorAll(".ff-toggle").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const input = cb as HTMLInputElement;
      const key = input.dataset.key!;
      const enabled = input.checked;
      try {
        await featureFlagsSet(key, enabled);
        await refreshFlagCache();
        // Update label color
        const label = input.closest("label");
        const nameDiv = label?.querySelector("div > div:first-child") as HTMLDivElement;
        if (nameDiv) nameDiv.style.color = enabled ? "#0f0" : "#666";
      } catch (e) {
        console.error("[GOAMP] Failed to set flag:", e);
        input.checked = !enabled; // revert
      }
    });
  });
}

