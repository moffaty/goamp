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

function openOverlay() {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "yt-search-overlay";
  overlay.innerHTML = `
    <div class="yt-search-container">
      <div class="yt-search-header">
        <input type="text" id="yt-search-input" placeholder="Search YouTube..." autocomplete="off" />
        <button id="yt-search-close">\u00d7</button>
      </div>
      <div id="yt-search-results" class="yt-search-results"></div>
      <div id="yt-search-status" class="yt-search-status"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  injectStyles();

  const input = document.getElementById("yt-search-input") as HTMLInputElement;
  const closeBtn = document.getElementById("yt-search-close")!;

  input.focus();

  let debounceTimer: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(input.value), 500);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
    if (e.key === "Enter") {
      clearTimeout(debounceTimer);
      doSearch(input.value);
    }
  });

  closeBtn.addEventListener("click", closeOverlay);
}

function closeOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

async function doSearch(query: string) {
  if (!query.trim()) return;

  const status = document.getElementById("yt-search-status");
  const results = document.getElementById("yt-search-results");
  if (!status || !results) return;

  status.textContent = "Searching...";
  results.innerHTML = "";

  try {
    const items = await searchYoutube(query);
    status.textContent = `${items.length} results`;
    track("youtube_search", { query: query.slice(0, 50), results: items.length });
    renderResults(items, results);
  } catch (e) {
    status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_search" });
  }
}

function renderResults(items: YoutubeResult[], container: HTMLElement) {
  container.innerHTML = "";

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "yt-result-row";
    row.innerHTML = `
      <img class="yt-result-thumb" src="${item.thumbnail}" alt="" />
      <div class="yt-result-info">
        <div class="yt-result-title">${escapeHtml(item.title)}</div>
        <div class="yt-result-meta">${escapeHtml(item.channel)} \u2022 ${formatDuration(item.duration)}</div>
      </div>
    `;

    row.addEventListener("click", () => playYoutubeTrack(item));
    container.appendChild(row);
  }
}

async function playYoutubeTrack(item: YoutubeResult) {
  const status = document.getElementById("yt-search-status");
  if (status) status.textContent = `Downloading: ${item.title}...`;

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
    if (status) status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_extract", video_id: item.id });
  }
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function injectStyles() {
  if (document.getElementById("yt-search-styles")) return;

  const style = document.createElement("style");
  style.id = "yt-search-styles";
  style.textContent = `
    #yt-search-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 40px;
    }
    .yt-search-container {
      width: 500px;
      max-height: 80vh;
      background: #1a1a2e;
      border: 1px solid #333;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .yt-search-header {
      display: flex;
      padding: 8px;
      gap: 8px;
      border-bottom: 1px solid #333;
    }
    #yt-search-input {
      flex: 1;
      background: #0f0f23;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      padding: 8px 12px;
      font-size: 14px;
      outline: none;
    }
    #yt-search-input:focus {
      border-color: #6c63ff;
    }
    #yt-search-close {
      background: none;
      border: none;
      color: #888;
      font-size: 20px;
      cursor: pointer;
      padding: 0 8px;
    }
    #yt-search-close:hover { color: #fff; }
    .yt-search-results {
      overflow-y: auto;
      flex: 1;
    }
    .yt-result-row {
      display: flex;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
      align-items: center;
    }
    .yt-result-row:hover {
      background: #2a2a4a;
    }
    .yt-result-thumb {
      width: 64px;
      height: 36px;
      object-fit: cover;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .yt-result-info {
      overflow: hidden;
      min-width: 0;
    }
    .yt-result-title {
      color: #fff;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .yt-result-meta {
      color: #888;
      font-size: 11px;
      margin-top: 2px;
    }
    .yt-search-status {
      padding: 8px 12px;
      color: #888;
      font-size: 12px;
      border-top: 1px solid #333;
    }
  `;
  document.head.appendChild(style);
}
