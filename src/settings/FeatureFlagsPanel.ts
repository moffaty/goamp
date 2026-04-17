import {
  featureFlagsList,
  featureFlagsSet,
  refreshFlagCache,
  type FeatureFlag,
} from "./feature-flags-service";
import { escapeHtml } from "../lib/ui-utils";
import { invoke } from "@tauri-apps/api/core";
import type { TagWeight } from "../recommendations/mood-service";

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
    return;
  }
  // Rec settings are non-fatal — run separately so errors don't clear the flag list
  renderRecSettings(list).catch(() => {});
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

async function renderRecSettings(container: HTMLDivElement): Promise<void> {
  const section = document.createElement("div");
  section.style.cssText = "padding: 8px 4px; border-top: 1px solid #333; margin-top: 8px;";
  section.innerHTML = `
    <div style="color:#fc0; font-weight:bold; margin-bottom:6px;">Recommendations</div>
    <div style="margin-bottom:6px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">BOOSTED TAGS</div>
      <div id="rec-boosted-tags" style="display:flex; flex-wrap:wrap; gap:3px;"></div>
    </div>
    <div style="margin-bottom:8px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">BLOCKED TAGS</div>
      <div id="rec-blocked-tags" style="display:flex; flex-wrap:wrap; gap:3px;"></div>
    </div>
    <div style="margin-bottom:6px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">MOOD INFLUENCE</div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="color:#555; font-size:9px;">weak</span>
        <input type="range" id="rec-mood-influence" min="1" max="7" step="1" value="4" style="flex:1; accent-color:#0f0;" />
        <span style="color:#555; font-size:9px;">strong</span>
      </div>
    </div>
    <div style="margin-bottom:6px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">DISCOVERY RATIO (tracks per batch)</div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="color:#555; font-size:9px;">0</span>
        <input type="range" id="rec-discovery" min="0" max="10" step="1" value="5" style="flex:1; accent-color:#0f0;" />
        <span style="color:#555; font-size:9px;">10</span>
      </div>
    </div>
  `;
  container.appendChild(section);

  try {
    const weights: TagWeight[] = await invoke("list_tag_weights", { scope: "global" });
    const boostedEl = section.querySelector("#rec-boosted-tags") as HTMLDivElement;
    const blockedEl = section.querySelector("#rec-blocked-tags") as HTMLDivElement;

    const renderChip = (tw: TagWeight, parent: HTMLDivElement) => {
      const chip = document.createElement("span");
      const isBoost = tw.weight > 1.0;
      chip.style.cssText = `
        padding: 1px 6px; border: 1px solid; cursor: pointer; font-size: 10px;
        border-color: ${isBoost ? "#0f0" : "#f44"};
        background: ${isBoost ? "#1a3a1a" : "#3a1a1a"};
        color: ${isBoost ? "#0f0" : "#f44"};
      `;
      chip.textContent = `${tw.tag} ×`;
      chip.title = "Click to remove";
      chip.addEventListener("click", async () => {
        await invoke("delete_tag_weight", { tag: tw.tag, scope: tw.scope });
        chip.remove();
      });
      parent.appendChild(chip);
    };

    weights.filter((w) => w.weight > 1.0).forEach((w) => renderChip(w, boostedEl));
    weights.filter((w) => w.weight < 1.0).forEach((w) => renderChip(w, blockedEl));
  } catch {
    // Non-fatal if rec tables not ready
  }

  const moodSlider = section.querySelector("#rec-mood-influence") as HTMLInputElement;
  const discoverySlider = section.querySelector("#rec-discovery") as HTMLInputElement;

  const savedMood = await invoke("get_setting", { key: "rec_mood_influence" }).catch(() => "4");
  const savedDisc = await invoke("get_setting", { key: "rec_discovery_count" }).catch(() => "5");
  moodSlider.value = String(savedMood ?? "4");
  discoverySlider.value = String(savedDisc ?? "5");

  moodSlider.addEventListener("change", () =>
    invoke("set_setting", { key: "rec_mood_influence", value: moodSlider.value }).catch(() => {})
  );
  discoverySlider.addEventListener("change", () =>
    invoke("set_setting", { key: "rec_discovery_count", value: discoverySlider.value }).catch(() => {})
  );
}

