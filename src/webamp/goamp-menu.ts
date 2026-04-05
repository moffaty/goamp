import { toggleSearchOverlay } from "../youtube/SearchOverlay";
import { togglePlaylistPanel } from "../playlists/PlaylistPanel";
import { toggleAudioDevicePanel } from "../settings/AudioDevicePanel";
import { toggleScrobbleSettings } from "../scrobble/ScrobbleSettings";
import { toggleFeatureFlagsPanel } from "../settings/FeatureFlagsPanel";
import { toggleVisualizerPanel } from "./VisualizerPanel";
import { toggleGenrePanel, toggleYouTubeSettings } from "../settings/GenrePanel";
import { toggleRadioPanel } from "../radio/RadioPanel";
import { openFolder, openFiles, loadSkin } from "./bridge";
import type Webamp from "webamp";

let menu: HTMLDivElement | null = null;
let webampRef: Webamp | null = null;

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: boolean;
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
    { label: "Playlists", shortcut: "Ctrl+P", action: () => togglePlaylistPanel() },
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
