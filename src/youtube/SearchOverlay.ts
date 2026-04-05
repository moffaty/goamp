import { convertFileSrc } from "@tauri-apps/api/core";
import {
  searchYoutube,
  extractAudio,
  extractAudioUrl,
  type YoutubeResult,
  type SearchSource,
} from "./youtube-service";
import {
  listPlaylists,
  createPlaylist,
  addTrackToPlaylist,
  type TrackInput,
} from "../lib/tauri-ipc";
import { track, trackError } from "../lib/analytics";
import { getSkinColors, escapeHtml, formatDuration } from "../lib/ui-utils";
import type Webamp from "webamp";

let overlay: HTMLElement | null = null;
let webampRef: Webamp | null = null;
let allResults: YoutubeResult[] = [];
let currentQuery = "";
let currentSource: SearchSource = "youtube";
const PAGE_SIZE = 20;

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

  const c = getSkinColors(webampRef);

  overlay = document.createElement("div");
  overlay.id = "yt-search-overlay";
  // Restore last source
  const savedSource = localStorage.getItem("goamp_search_source") as SearchSource | null;
  if (savedSource === "youtube" || savedSource === "soundcloud") {
    currentSource = savedSource;
  }

  overlay.innerHTML = `
    <div class="yt-search-container" style="background:${c.bg};border-color:${c.fg}">
      <div class="yt-source-tabs" style="border-color:${c.fg}">
        <div class="yt-source-tab${currentSource === "youtube" ? " yt-source-active" : ""}" data-source="youtube" style="color:${currentSource === "youtube" ? c.accent : c.text}">YouTube</div>
        <div class="yt-source-tab${currentSource === "soundcloud" ? " yt-source-active" : ""}" data-source="soundcloud" style="color:${currentSource === "soundcloud" ? c.accent : c.text}">SoundCloud</div>
      </div>
      <div class="yt-search-header" style="border-color:${c.fg}">
        <div class="yt-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c.text}" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </div>
        <input type="text" id="yt-search-input" placeholder="Search ${currentSource === "soundcloud" ? "SoundCloud" : "YouTube"}..." autocomplete="off"
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

  // Source tab handlers
  overlay.querySelectorAll(".yt-source-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const src = (tab as HTMLElement).dataset.source as SearchSource;
      if (src === currentSource) return;
      currentSource = src;
      localStorage.setItem("goamp_search_source", src);
      // Update tab styles
      overlay!.querySelectorAll(".yt-source-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = el.dataset.source === src;
        el.classList.toggle("yt-source-active", isActive);
        el.style.color = isActive ? c.accent : c.text;
      });
      // Update placeholder
      const inp = document.getElementById("yt-search-input") as HTMLInputElement;
      if (inp) inp.placeholder = `Search ${src === "soundcloud" ? "SoundCloud" : "YouTube"}...`;
      // Clear results on source switch
      allResults = [];
      const results = document.getElementById("yt-search-results");
      if (results) results.innerHTML = "";
      document.getElementById("yt-pagination")?.remove();
      const status = document.getElementById("yt-search-status");
      if (status) status.textContent = "Press Enter to search";
    });
  });

  const input = document.getElementById("yt-search-input") as HTMLInputElement;
  const closeBtn = document.getElementById("yt-search-close")!;

  // Restore last search query and results
  const lastQuery = localStorage.getItem("goamp_yt_last_query") || "";
  if (lastQuery) {
    input.value = lastQuery;
    currentQuery = lastQuery; // restore for pagination
    // Restore cached results
    const cachedResults = localStorage.getItem("goamp_yt_last_results");
    if (cachedResults) {
      try {
        const items: YoutubeResult[] = JSON.parse(cachedResults);
        const resultsContainer = document.getElementById("yt-search-results");
        const statusEl = document.getElementById("yt-search-status");
        if (resultsContainer && items.length > 0) {
          renderResults(items, resultsContainer);
          if (statusEl) statusEl.textContent = `${items.length} results (cached)`;
        }
      } catch {}
    }
  }

  input.focus();
  input.select();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideSuggestions();
      closeOverlay();
    }
    if (e.key === "Enter") {
      hideSuggestions();
      doSearch(input.value);
    }
  });

  closeBtn.addEventListener("click", closeOverlay);

  // Click outside container closes overlay
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

function closeOverlay() {
  hideSuggestions();
  if (overlay) {
    overlay.classList.add("yt-closing");
    setTimeout(() => {
      overlay?.remove();
      overlay = null;
    }, 150);
  }
}

function hideSuggestions() {
  document.getElementById("yt-suggestions")?.remove();
}

async function doSearch(query: string) {
  if (!query.trim()) return;
  currentQuery = query.trim();
  localStorage.setItem("goamp_yt_last_query", currentQuery);

  const status = document.getElementById("yt-search-status");
  const results = document.getElementById("yt-search-results");
  if (!status || !results) return;

  status.innerHTML = `<span class="yt-loading">Searching</span>`;
  results.innerHTML = "";
  allResults = [];

  try {
    const items = await searchYoutube(currentQuery, PAGE_SIZE, currentSource);
    allResults = items;
    localStorage.setItem("goamp_yt_last_results", JSON.stringify(items));
    track("youtube_search", {
      query: currentQuery.slice(0, 50),
      results: items.length,
      source: currentSource,
    });
    showPage(results, 0, "none");
  } catch (e) {
    status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_search" });
  }
}

async function ensureResultsForPage(page: number): Promise<boolean> {
  const needed = (page + 1) * PAGE_SIZE;
  if (allResults.length >= needed) return true;

  const status = document.getElementById("yt-search-status");
  if (status) status.innerHTML = `<span class="yt-loading">Loading</span>`;

  try {
    const items = await searchYoutube(currentQuery, needed, currentSource);
    if (items.length <= allResults.length) return false; // no more results
    allResults = items;
    localStorage.setItem("goamp_yt_last_results", JSON.stringify(items));
    return true;
  } catch (e) {
    if (status) status.textContent = `Error: ${e}`;
    trackError(e, { action: "youtube_load_page" });
    return false;
  }
}

function showPage(container: HTMLElement, page: number, direction: "left" | "right" | "none") {
  const status = document.getElementById("yt-search-status");
  const start = page * PAGE_SIZE;
  const pageItems = allResults.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
  const hasMore = allResults.length >= (page + 1) * PAGE_SIZE; // might have next


  // Animate out old content
  if (direction !== "none") {
    const slideOut = direction === "right" ? "yt-page-out-left" : "yt-page-out-right";
    const slideIn = direction === "right" ? "yt-page-in-right" : "yt-page-in-left";
    container.classList.add(slideOut);
    setTimeout(() => {
      container.classList.remove(slideOut);
      renderPageContent(container, pageItems);
      container.classList.add(slideIn);
      setTimeout(() => container.classList.remove(slideIn), 200);
    }, 150);
  } else {
    renderPageContent(container, pageItems);
  }

  if (status) {
    const pageInfo = totalPages > 1 ? ` \u2022 Page ${page + 1}/${totalPages}${hasMore ? "+" : ""}` : "";
    status.textContent = `${allResults.length} results${pageInfo}`;
  }

  // Update pagination controls
  updatePagination(container, page, hasMore);
}

function updatePagination(container: HTMLElement, page: number, hasMore: boolean) {
  document.getElementById("yt-pagination")?.remove();

  const totalLoaded = Math.ceil(allResults.length / PAGE_SIZE);
  if (totalLoaded <= 1 && !hasMore) return; // single page, no controls

  const c = getSkinColors(webampRef);
  const nav = document.createElement("div");
  nav.id = "yt-pagination";
  nav.className = "yt-pagination";
  nav.style.borderColor = c.fg;

  // Prev button
  if (page > 0) {
    const prev = document.createElement("div");
    prev.className = "yt-page-btn";
    prev.style.color = c.accent;
    prev.textContent = "\u25c0";
    prev.addEventListener("click", () => {
      showPage(container, page - 1, "left");
    });
    nav.appendChild(prev);
  }

  // Page number buttons
  for (let i = 0; i < totalLoaded; i++) {
    const btn = document.createElement("div");
    btn.className = "yt-page-num" + (i === page ? " yt-page-num-active" : "");
    btn.style.color = i === page ? c.accent : c.text;
    btn.textContent = `${i + 1}`;
    if (i !== page) {
      btn.addEventListener("click", () => {
        const direction = i > page ? "right" : "left";
        showPage(container, i, direction);
      });
    }
    nav.appendChild(btn);
  }

  // Next button (loads more if needed)
  if (hasMore) {
    const next = document.createElement("div");
    next.className = "yt-page-btn";
    next.style.color = c.accent;
    next.textContent = "\u25b6";
    next.addEventListener("click", async () => {
      const ok = await ensureResultsForPage(page + 1);
      if (ok) {
        showPage(container, page + 1, "right");
      } else {
        const status = document.getElementById("yt-search-status");
        if (status) status.textContent = "No more results";
      }
    });
    nav.appendChild(next);
  }

  // Insert pagination before the results container (after header)
  const header = container.closest(".yt-search-container")?.querySelector(".yt-search-header");
  if (header && header.parentElement) {
    header.parentElement.insertBefore(nav, container);
  }
}

function renderPageContent(container: HTMLElement, items: YoutubeResult[]) {
  container.innerHTML = "";
  const c = getSkinColors(webampRef);

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

/** Compat wrapper for cached results restore */
function renderResults(items: YoutubeResult[], container: HTMLElement) {
  allResults = items;
  showPage(container, 0, "none");
}

function showContextMenu(
  e: MouseEvent,
  item: YoutubeResult,
  c: ReturnType<typeof getSkinColors>
) {
  // Remove existing context menu & submenu
  document.getElementById("yt-ctx-menu")?.remove();
  document.getElementById("yt-ctx-submenu")?.remove();

  const menu = document.createElement("div");
  menu.id = "yt-ctx-menu";
  menu.style.cssText = `
    position:fixed; left:${e.clientX}px; top:${e.clientY}px;
    background:${c.bg}; border:1px solid ${c.fg};
    z-index:10001; font-family:inherit; font-size:11px;
    box-shadow:2px 2px 0 rgba(0,0,0,0.4);
    min-width:160px;
  `;

  // Play now
  const playRow = createMenuItem("\u25b6 Play now", c, () => {
    closeCtxMenu();
    playNow(item);
  });
  menu.appendChild(playRow);

  // Add to current (Webamp) playlist
  const addCurrentRow = createMenuItem("\u2795 Add to queue", c, () => {
    closeCtxMenu();
    addToWebampQueue(item);
  });
  menu.appendChild(addCurrentRow);

  // Add to playlist → submenu with delayed close
  let submenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelSubmenuClose = () => {
    if (submenuCloseTimer) {
      clearTimeout(submenuCloseTimer);
      submenuCloseTimer = null;
    }
  };

  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    submenuCloseTimer = setTimeout(() => {
      const sub = document.getElementById("yt-ctx-submenu");
      if (sub && !sub.matches(":hover")) sub.remove();
    }, 300);
  };

  const addToPlRow = createMenuItem("\u{1f4c1} Add to playlist \u25b8", c, () => {});
  addToPlRow.addEventListener("mouseenter", () => {
    cancelSubmenuClose();
    showPlaylistSubmenu(addToPlRow, item, c, cancelSubmenuClose, scheduleSubmenuClose);
  });
  addToPlRow.addEventListener("mouseleave", () => {
    scheduleSubmenuClose();
  });
  menu.appendChild(addToPlRow);

  document.body.appendChild(menu);

  const closeCtxMenu = () => {
    menu.remove();
    document.getElementById("yt-ctx-submenu")?.remove();
    document.removeEventListener("click", onOutsideClick);
  };

  const onOutsideClick = (ev: MouseEvent) => {
    const sub = document.getElementById("yt-ctx-submenu");
    if (!menu.contains(ev.target as Node) && !(sub && sub.contains(ev.target as Node))) {
      closeCtxMenu();
    }
  };
  requestAnimationFrame(() => document.addEventListener("click", onOutsideClick));
}

function createMenuItem(
  label: string,
  c: ReturnType<typeof getSkinColors>,
  onClick: () => void
): HTMLDivElement {
  const row = document.createElement("div");
  row.textContent = label;
  row.style.cssText = `
    padding:4px 10px; cursor:pointer; color:${c.text};
    white-space:nowrap;
  `;
  row.addEventListener("mouseenter", () => {
    row.style.background = "rgba(255,255,255,0.1)";
  });
  row.addEventListener("mouseleave", () => {
    row.style.background = "none";
  });
  row.addEventListener("click", onClick);
  return row;
}

async function showPlaylistSubmenu(
  anchor: HTMLElement,
  item: YoutubeResult,
  c: ReturnType<typeof getSkinColors>,
  cancelClose: () => void,
  scheduleClose: () => void,
) {
  document.getElementById("yt-ctx-submenu")?.remove();

  const sub = document.createElement("div");
  sub.id = "yt-ctx-submenu";

  const rect = anchor.getBoundingClientRect();
  sub.style.cssText = `
    position:fixed; left:${rect.right - 2}px; top:${rect.top}px;
    background:${c.bg}; border:1px solid ${c.fg};
    z-index:10002; font-family:inherit; font-size:11px;
    box-shadow:2px 2px 0 rgba(0,0,0,0.4);
    min-width:140px; max-height:200px; overflow-y:auto;
    scrollbar-width:thin;
  `;

  // "New playlist..." option
  const newRow = createMenuItem("\u2795 New playlist...", c, async () => {
    const name = prompt("Playlist name:");
    if (!name?.trim()) return;
    try {
      const pl = await createPlaylist(name.trim());
      await downloadAndAddToPlaylist(item, pl.id);
    } catch (e) {
      trackError(e, { action: "ctx_new_playlist" });
    }
    document.getElementById("yt-ctx-menu")?.remove();
    sub.remove();
  });
  sub.appendChild(newRow);

  // Separator
  const sep = document.createElement("div");
  sep.style.cssText = `height:1px;background:${c.fg};margin:2px 0`;
  sub.appendChild(sep);

  // Load playlists
  try {
    const playlists = await listPlaylists();
    if (playlists.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No playlists";
      empty.style.cssText = `padding:4px 10px;color:${c.fg};font-style:italic`;
      sub.appendChild(empty);
    } else {
      for (const pl of playlists) {
        const plRow = createMenuItem(`${pl.name} (${pl.track_count})`, c, async () => {
          await downloadAndAddToPlaylist(item, pl.id);
          document.getElementById("yt-ctx-menu")?.remove();
          sub.remove();
        });
        sub.appendChild(plRow);
      }
    }
  } catch {
    const err = document.createElement("div");
    err.textContent = "Error loading playlists";
    err.style.cssText = `padding:4px 10px;color:red`;
    sub.appendChild(err);
  }

  document.body.appendChild(sub);

  // Keep submenu open when hovering, use shared timer
  sub.addEventListener("mouseenter", () => cancelClose());
  sub.addEventListener("mouseleave", () => scheduleClose());
}

async function downloadAndAddToPlaylist(item: YoutubeResult, playlistId: string) {
  const status = document.getElementById("yt-search-status");
  if (status) status.innerHTML = `<span class="yt-loading">Downloading</span> ${escapeHtml(item.title)}`;

  try {
    const filePath = await extractForItem(item);
    const trackInput: TrackInput = {
      title: item.title,
      artist: item.channel,
      duration: item.duration,
      source: "youtube",
      source_id: filePath,
      genre: item.genre || "",
    };
    await addTrackToPlaylist(playlistId, trackInput);

    if (status) status.textContent = `Added to playlist: ${item.title}`;
    track("youtube_add_to_saved_playlist", { video_id: item.id });
  } catch (e) {
    if (status) status.textContent = `Error: ${e}`;
    trackError(e, { action: "add_to_playlist", video_id: item.id });
  }
}

/** Extract audio file path / URL — uses video_id for YouTube, webpage_url for SoundCloud */
async function extractForItem(item: YoutubeResult): Promise<string> {
  if (item.source === "youtube" || !item.webpage_url) {
    return extractAudio(item.id);
  }
  return extractAudioUrl(item.webpage_url);
}

function playNow(item: YoutubeResult) {
  const row = document.querySelector(".yt-result-row") ?? document.createElement("div");
  playYoutubeTrack(item, row as HTMLElement);
}

async function addToWebampQueue(item: YoutubeResult) {
  const status = document.getElementById("yt-search-status");
  if (status) status.innerHTML = `<span class="yt-loading">Downloading</span> ${escapeHtml(item.title)}`;

  try {
    const filePath = await extractForItem(item);
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
    const filePath = await extractForItem(item);
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
    @keyframes yt-page-slide-in-right {
      from { opacity: 0; transform: translateX(30px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes yt-page-slide-in-left {
      from { opacity: 0; transform: translateX(-30px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes yt-page-slide-out-left {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(-30px); }
    }
    @keyframes yt-page-slide-out-right {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(30px); }
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

    .yt-source-tabs {
      display: flex;
      border-bottom: 1px solid;
    }
    .yt-source-tab {
      flex: 1;
      padding: 5px 8px;
      text-align: center;
      cursor: pointer;
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      transition: background 0.1s;
    }
    .yt-source-tab:hover { background: rgba(255,255,255,0.06); }
    .yt-source-tab.yt-source-active {
      font-weight: bold;
      border-bottom: 2px solid currentColor;
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

    .yt-search-results.yt-page-out-left {
      animation: yt-page-slide-out-left 0.15s ease-in forwards;
    }
    .yt-search-results.yt-page-out-right {
      animation: yt-page-slide-out-right 0.15s ease-in forwards;
    }
    .yt-search-results.yt-page-in-right {
      animation: yt-page-slide-in-right 0.2s ease-out;
    }
    .yt-search-results.yt-page-in-left {
      animation: yt-page-slide-in-left 0.2s ease-out;
    }

    .yt-pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      gap: 4px;
      border-bottom: 1px solid;
    }
    .yt-page-btn {
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
    }
    .yt-page-btn:hover { background: rgba(255,255,255,0.08); }
    .yt-page-num {
      padding: 2px 6px;
      cursor: pointer;
      font-size: 10px;
      min-width: 16px;
      text-align: center;
    }
    .yt-page-num:hover { background: rgba(255,255,255,0.08); }
    .yt-page-num-active {
      cursor: default;
      font-weight: bold;
      border-bottom: 1px solid currentColor;
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

