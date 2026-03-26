import { convertFileSrc } from "@tauri-apps/api/core";
import {
  searchYoutube,
  extractAudio,
  formatDuration,
  type YoutubeResult,
} from "./youtube-service";
import { track, trackError } from "../lib/analytics";
import type Webamp from "webamp";

let overlay: HTMLElement | null = null;
let webampRef: Webamp | null = null;

export function initSearchOverlay(webamp: Webamp) {
  webampRef = webamp;
}

export function toggleSearchOverlay() {
  if (overlay) {
    closeOverlay();
  } else {
    openOverlay();
  }
}

/** Parse hex color to RGB */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/** Relative luminance (WCAG) */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ensure text is readable on background — flip to white/black if contrast < 4.5:1 */
function ensureContrast(textColor: string, bgColor: string): string {
  const lText = luminance(textColor);
  const lBg = luminance(bgColor);
  const ratio =
    (Math.max(lText, lBg) + 0.05) / (Math.min(lText, lBg) + 0.05);
  if (ratio >= 4.5) return textColor;
  // Pick white or black depending on bg brightness
  return lBg > 0.4 ? "#000000" : "#ffffff";
}

/** Read skin colors from Webamp Redux store */
function getSkinColors(): {
  bg: string;
  fg: string;
  text: string;
  accent: string;
  textBg: string;
} {
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
      const textBg = colors[1] || defaults.textBg;
      const rawText = colors[0] || defaults.text;
      const rawAccent = colors[18] || colors[2] || defaults.accent;

      return {
        bg,
        fg: colors[4] || defaults.fg,
        text: ensureContrast(rawText, bg),
        accent: ensureContrast(rawAccent, bg),
        textBg,
      };
    }
  } catch {}

  return defaults;
}

function openOverlay() {
  if (overlay) return;

  const c = getSkinColors();

  overlay = document.createElement("div");
  overlay.id = "yt-search-overlay";
  overlay.innerHTML = `
    <div class="yt-search-container" style="background:${c.bg};border-color:${c.fg}">
      <div class="yt-search-header" style="border-color:${c.fg}">
        <div class="yt-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c.text}" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </div>
        <input type="text" id="yt-search-input" placeholder="Search YouTube..." autocomplete="off"
               style="background:${c.textBg};color:${c.text};border-color:${c.fg}" />
        <button id="yt-search-close" style="color:${c.text}">\u00d7</button>
      </div>
      <div id="yt-search-results" class="yt-search-results"></div>
      <div id="yt-search-status" class="yt-search-status" style="color:${c.text};border-color:${c.fg}">
        Press Enter to search \u2022 Esc to close
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  injectStyles(c);

  const input = document.getElementById("yt-search-input") as HTMLInputElement;
  const closeBtn = document.getElementById("yt-search-close")!;

  // Restore last search query
  const lastQuery = localStorage.getItem("goamp_yt_last_query") || "";
  if (lastQuery) {
    input.value = lastQuery;
  }

  input.focus();
  input.select();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
    if (e.key === "Enter") doSearch(input.value);
  });

  closeBtn.addEventListener("click", closeOverlay);

  // Click outside container closes overlay
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

function closeOverlay() {
  if (overlay) {
    overlay.classList.add("yt-closing");
    setTimeout(() => {
      overlay?.remove();
      overlay = null;
    }, 150);
  }
}

async function doSearch(query: string) {
  if (!query.trim()) return;
  localStorage.setItem("goamp_yt_last_query", query.trim());

  const status = document.getElementById("yt-search-status");
  const results = document.getElementById("yt-search-results");
  if (!status || !results) return;

  status.innerHTML = `<span class="yt-loading">Searching</span>`;
  results.innerHTML = "";

  try {
    const items = await searchYoutube(query);
    status.textContent = `${items.length} results found`;
    track("youtube_search", {
      query: query.slice(0, 50),
      results: items.length,
    });
    renderResults(items, results);
  } catch (e) {
    status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_search" });
  }
}

function renderResults(items: YoutubeResult[], container: HTMLElement) {
  container.innerHTML = "";
  const c = getSkinColors();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = document.createElement("div");
    row.className = "yt-result-row";
    row.style.animationDelay = `${i * 30}ms`;
    row.innerHTML = `
      <img class="yt-result-thumb" src="${item.thumbnail}" alt="" loading="lazy" />
      <div class="yt-result-info">
        <div class="yt-result-title" style="color:${c.text}">${escapeHtml(item.title)}</div>
        <div class="yt-result-meta" style="color:${c.accent}">${escapeHtml(item.channel)} \u2022 ${formatDuration(item.duration)}</div>
      </div>
      <div class="yt-result-duration" style="color:${c.fg}">${formatDuration(item.duration)}</div>
    `;

    row.addEventListener("click", () => playYoutubeTrack(item, row));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, item, c);
    });
    container.appendChild(row);
  }
}

function showContextMenu(
  e: MouseEvent,
  item: YoutubeResult,
  c: ReturnType<typeof getSkinColors>
) {
  // Remove existing context menu
  document.getElementById("yt-ctx-menu")?.remove();

  const menu = document.createElement("div");
  menu.id = "yt-ctx-menu";
  menu.style.cssText = `
    position:fixed; left:${e.clientX}px; top:${e.clientY}px;
    background:${c.bg}; border:1px solid ${c.fg};
    z-index:10001; font-family:inherit; font-size:11px;
    box-shadow:2px 2px 0 rgba(0,0,0,0.4);
    min-width:160px;
  `;

  const actions = [
    { label: "\u25b6 Play now", action: () => playNow(item) },
    { label: "\u2795 Add to playlist", action: () => addToPlaylist(item) },
  ];

  for (const { label, action } of actions) {
    const row = document.createElement("div");
    row.textContent = label;
    row.style.cssText = `
      padding:4px 10px; cursor:pointer; color:${c.text};
      white-space:nowrap;
    `;
    row.addEventListener("mouseenter", () => {
      row.style.background = `rgba(255,255,255,0.1)`;
    });
    row.addEventListener("mouseleave", () => {
      row.style.background = "none";
    });
    row.addEventListener("click", () => {
      menu.remove();
      action();
    });
    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  // Close on click outside
  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    }
  };
  setTimeout(() => document.addEventListener("click", closeMenu), 0);
}

function playNow(item: YoutubeResult) {
  const row = document.querySelector(".yt-result-row") as HTMLElement;
  playYoutubeTrack(item, row || document.createElement("div"));
}

async function addToPlaylist(item: YoutubeResult) {
  const status = document.getElementById("yt-search-status");
  if (status) status.innerHTML = `<span class="yt-loading">Downloading</span> ${escapeHtml(item.title)}`;

  try {
    const filePath = await extractAudio(item.id);
    const url = convertFileSrc(filePath);

    if (webampRef) {
      webampRef.appendTracks([
        {
          metaData: {
            artist: item.channel,
            title: item.title,
          },
          url,
          duration: item.duration,
        },
      ]);
    }

    if (status) status.textContent = `Added: ${item.title}`;

    track("youtube_add_to_playlist", {
      video_id: item.id,
      title: item.title.slice(0, 100),
    });
  } catch (e) {
    if (status) status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_add", video_id: item.id });
  }
}

async function playYoutubeTrack(item: YoutubeResult, row: HTMLElement) {
  const status = document.getElementById("yt-search-status");
  row.classList.add("yt-downloading");
  if (status) status.innerHTML = `<span class="yt-loading">Downloading</span> ${escapeHtml(item.title)}`;

  try {
    const filePath = await extractAudio(item.id);
    const url = convertFileSrc(filePath);

    if (webampRef) {
      webampRef.setTracksToPlay([
        {
          metaData: {
            artist: item.channel,
            title: item.title,
          },
          url,
          duration: item.duration,
        },
      ]);
    }

    track("youtube_play", {
      video_id: item.id,
      title: item.title.slice(0, 100),
      channel: item.channel.slice(0, 100),
    });

    closeOverlay();
  } catch (e) {
    row.classList.remove("yt-downloading");
    if (status) status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_extract", video_id: item.id });
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function injectStyles(c: ReturnType<typeof getSkinColors>) {
  const existing = document.getElementById("yt-search-styles");
  if (existing) existing.remove(); // re-inject with new colors

  const style = document.createElement("style");
  style.id = "yt-search-styles";
  style.textContent = `
    @keyframes yt-slide-in {
      from { opacity: 0; transform: translateY(-10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes yt-slide-out {
      from { opacity: 1; }
      to { opacity: 0; transform: scale(0.97); }
    }
    @keyframes yt-row-in {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes yt-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes yt-scanline {
      0% { background-position: 0 0; }
      100% { background-position: 0 4px; }
    }
    @keyframes yt-dots {
      0% { content: ""; }
      25% { content: "."; }
      50% { content: ".."; }
      75% { content: "..."; }
    }

    #yt-search-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 30px;
      animation: yt-slide-in 0.2s ease-out;
    }
    #yt-search-overlay.yt-closing {
      animation: yt-slide-out 0.15s ease-in forwards;
    }

    .yt-search-container {
      width: 460px;
      max-height: 75vh;
      border: 2px solid;
      display: flex;
      flex-direction: column;
      font-family: "MS Sans Serif", "Microsoft Sans Serif", Arial, sans-serif;
      font-size: 11px;
      box-shadow: 1px 1px 0 rgba(255,255,255,0.1) inset, -1px -1px 0 rgba(0,0,0,0.3) inset;
      position: relative;
      overflow: hidden;
    }
    /* CRT scanline overlay */
    .yt-search-container::after {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0,0,0,0.08) 2px,
        rgba(0,0,0,0.08) 4px
      );
      pointer-events: none;
      animation: yt-scanline 0.5s linear infinite;
    }

    .yt-search-header {
      display: flex;
      padding: 6px;
      gap: 4px;
      border-bottom: 1px solid;
      align-items: center;
    }
    .yt-search-icon {
      flex-shrink: 0;
      padding: 0 4px;
      display: flex;
      align-items: center;
    }
    #yt-search-input {
      flex: 1;
      border: 1px solid;
      padding: 4px 6px;
      font-family: inherit;
      font-size: 11px;
      outline: none;
      letter-spacing: 0.5px;
    }
    #yt-search-input::placeholder {
      opacity: 0.5;
    }
    #yt-search-close {
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      padding: 0 6px;
      line-height: 1;
    }
    #yt-search-close:hover { opacity: 0.7; }

    .yt-search-results {
      overflow-y: auto;
      flex: 1;
      scrollbar-width: thin;
      scrollbar-color: ${c.fg} ${c.textBg};
    }
    .yt-search-results::-webkit-scrollbar { width: 8px; }
    .yt-search-results::-webkit-scrollbar-track { background: ${c.textBg}; }
    .yt-search-results::-webkit-scrollbar-thumb { background: ${c.fg}; }

    .yt-result-row {
      display: flex;
      gap: 8px;
      padding: 4px 8px;
      cursor: pointer;
      align-items: center;
      animation: yt-row-in 0.2s ease-out both;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      transition: background 0.1s;
    }
    .yt-result-row:hover {
      background: rgba(255,255,255,0.08);
    }
    .yt-result-row.yt-downloading {
      animation: yt-pulse 1s ease-in-out infinite;
    }
    .yt-result-thumb {
      width: 48px;
      height: 27px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.1);
      image-rendering: auto;
    }
    .yt-result-info {
      overflow: hidden;
      min-width: 0;
      flex: 1;
    }
    .yt-result-title {
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: 0.3px;
    }
    .yt-result-meta {
      font-size: 10px;
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .yt-result-duration {
      font-size: 10px;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }

    .yt-search-status {
      padding: 5px 8px;
      font-size: 10px;
      border-top: 1px solid;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .yt-loading::after {
      content: "";
      animation: yt-dots 1.5s steps(4, end) infinite;
    }
  `;
  document.head.appendChild(style);
}
