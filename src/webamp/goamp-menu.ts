import { invoke } from "@tauri-apps/api/core";
import { toggleSearchOverlay } from "../youtube/SearchOverlay";
import { togglePlaylistPanel } from "../playlists/PlaylistPanel";
import { toggleAudioDevicePanel } from "../settings/AudioDevicePanel";
import { toggleScrobbleSettings } from "../scrobble/ScrobbleSettings";
import { toggleFeatureFlagsPanel } from "../settings/FeatureFlagsPanel";
import { toggleVisualizerPanel } from "./VisualizerPanel";
import { toggleMilkdrop } from "./milkdrop-controller";
import { toggleGenrePanel, toggleYouTubeSettings } from "../settings/GenrePanel";
import { toggleRadioPanel } from "../radio/RadioPanel";
import { toggleRecommendationPanel } from "../recommendations/RecommendationPanel";
import { openFolder, openFiles, loadSkin } from "./file-actions";
import { moodService } from "../recommendations/mood-service";
import type Webamp from "webamp";
let menu: HTMLDivElement | null = null;
let webampRef: Webamp | null = null;

interface SubMenuItem {
  label: string;
  action: () => void;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: boolean;
}

export function buildSignalMenuItems(
  canonicalId: string,
  _artist: string,
  _title: string
): MenuItem[] {
  const activeMood = moodService.activeMood;

  const boost = (scope: string) => {
    invoke("record_track_signal", { canonicalId, signal: 1, scope }).catch(console.error);
  };
  const block = (scope: string) => {
    invoke("record_track_signal", { canonicalId, signal: -1, scope }).catch(console.error);
  };

  if (activeMood) {
    return [
      {
        label: "↑ Recommend similar",
        action: () =>
          showScopeSubmenu([
            { label: `In ${activeMood} only`, action: () => boost(`mood:${activeMood}`) },
            { label: "Globally (all moods)", action: () => boost("global") },
          ]),
      },
      {
        label: "✕ Don't recommend",
        action: () =>
          showScopeSubmenu([
            { label: `In ${activeMood} only`, action: () => block(`mood:${activeMood}`) },
            { label: "Globally (all moods)", action: () => block("global") },
          ]),
      },
    ];
  }

  return [
    { label: "↑ Recommend similar", action: () => boost("global") },
    { label: "✕ Don't recommend", action: () => block("global") },
  ];
}

let scopeSubmenu: HTMLDivElement | null = null;

function showScopeSubmenu(items: SubMenuItem[]): void {
  if (scopeSubmenu) scopeSubmenu.remove();
  scopeSubmenu = document.createElement("div");
  scopeSubmenu.style.cssText = `
    position: fixed; background: #1a1a2e; border: 1px solid #444; z-index: 10002;
    font-family: 'MS Sans Serif', Tahoma, sans-serif; font-size: 11px; color: #0f0;
    min-width: 160px;
  `;
  items.forEach((item) => {
    const row = document.createElement("div");
    row.style.cssText = "padding: 4px 12px; cursor: pointer;";
    row.textContent = item.label;
    row.addEventListener("mouseenter", () => (row.style.background = "#2a2a4a"));
    row.addEventListener("mouseleave", () => (row.style.background = ""));
    row.addEventListener("click", () => {
      item.action();
      scopeSubmenu?.remove();
      scopeSubmenu = null;
      closeGoampMenu();
    });
    scopeSubmenu!.appendChild(row);
  });
  const menuEl = document.getElementById("goamp-context-menu");
  if (menuEl) {
    const rect = menuEl.getBoundingClientRect();
    scopeSubmenu.style.left = `${rect.right + 2}px`;
    scopeSubmenu.style.top = `${rect.top}px`;
  }
  document.body.appendChild(scopeSubmenu);
  setTimeout(() => {
    document.addEventListener(
      "mousedown",
      () => {
        scopeSubmenu?.remove();
        scopeSubmenu = null;
      },
      { once: true }
    );
  }, 0);
}

export function initGoampMenu(webamp: Webamp) {
  webampRef = webamp;

  // Use capture phase to intercept before Webamp's own context menu
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;

    // Show on any Webamp element — intercept all to prevent native Webamp menus
    const webampEl = document.getElementById("webamp");
    if (!webampEl || !webampEl.contains(target)) return;

    // Stop Webamp from handling this event
    e.preventDefault();
    e.stopImmediatePropagation();
    showGoampMenu(e.clientX, e.clientY);
  }, true);

  // Close on click outside
  document.addEventListener("mousedown", (e) => {
    if (menu && !menu.contains(e.target as Node)) {
      closeGoampMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu) {
      closeGoampMenu();
    }
  });
}

function showGoampMenu(x: number, y: number) {
  closeGoampMenu();

  const items: MenuItem[] = [
    { label: "Search", shortcut: "Ctrl+Y", action: () => toggleSearchOverlay() },
    { label: "Genres", shortcut: "Ctrl+G", action: () => toggleGenrePanel() },
    { label: "Internet Radio", shortcut: "Ctrl+R", action: () => toggleRadioPanel() },
    { label: "Recommendations", shortcut: "Ctrl+Shift+R", action: () => toggleRecommendationPanel() },
    { label: "Playlists", shortcut: "Ctrl+P", action: () => togglePlaylistPanel() },
    { label: "Visualizer", shortcut: "Ctrl+V", action: () => toggleMilkdrop() },
    { label: "Visualizer Presets", shortcut: "V", action: () => toggleVisualizerPanel() },
    {
      label: "Open Folder",
      shortcut: "Ctrl+O",
      action: () => { if (webampRef) openFolder(webampRef); },
      separator: true,
    },
    {
      label: "Open Files",
      shortcut: "Ctrl+Shift+O",
      action: () => { if (webampRef) openFiles(webampRef); },
    },
    {
      label: "Load Skin",
      shortcut: "Ctrl+S",
      action: () => { if (webampRef) loadSkin(webampRef); },
      separator: true,
    },
    { label: "Audio Devices", shortcut: "Ctrl+D", action: () => toggleAudioDevicePanel() },
    {
      label: "Scrobbling",
      shortcut: "Ctrl+Shift+L",
      action: () => toggleScrobbleSettings(),
    },
    {
      label: "YouTube Settings",
      shortcut: "Ctrl+Shift+Y",
      action: () => toggleYouTubeSettings(),
      separator: true,
    },
    { label: "Feature Flags", shortcut: "Ctrl+Shift+`", action: () => toggleFeatureFlagsPanel() },
  ];

  const state = (webampRef as any)?.store?.getState?.();
  const currentTrack = state?.tracks?.[state?.playlist?.currentTrack];
  if (currentTrack) {
    const canonicalId = `${currentTrack.artist ?? ""}:${currentTrack.defaultName ?? ""}:${currentTrack.url ?? ""}`;
    items.push({ label: "", action: () => {}, separator: true });
    items.push(...buildSignalMenuItems(canonicalId, currentTrack.artist ?? "", currentTrack.defaultName ?? ""));
  }

  menu = document.createElement("div");
  menu.id = "goamp-context-menu";
  menu.style.cssText = `
    position: fixed; z-index: 20000;
    background: #1a1a2e; border: 1px solid #555; border-radius: 4px;
    padding: 4px 0; min-width: 200px;
    font-family: 'MS Sans Serif', 'Tahoma', sans-serif; font-size: 11px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.8);
  `;

  // Position: ensure it stays within viewport
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 26 - 20)}px`;

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.style.cssText = "height:1px; background:#333; margin:3px 8px;";
      menu.appendChild(sep);
    }

    const row = document.createElement("div");
    row.style.cssText = `
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 12px; cursor: pointer; color: #0f0;
    `;
    row.addEventListener("mouseenter", () => { row.style.background = "#333"; });
    row.addEventListener("mouseleave", () => { row.style.background = "none"; });
    row.addEventListener("click", () => {
      closeGoampMenu();
      item.action();
    });

    const label = document.createElement("span");
    label.textContent = item.label;

    const shortcut = document.createElement("span");
    shortcut.textContent = item.shortcut || "";
    shortcut.style.cssText = "color: #666; font-size: 10px; margin-left: 16px;";

    row.appendChild(label);
    row.appendChild(shortcut);
    menu.appendChild(row);
  }

  document.body.appendChild(menu);
}

function closeGoampMenu() {
  if (menu) {
    menu.remove();
    menu = null;
  }
}

