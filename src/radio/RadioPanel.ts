import {
  radioSearch,
  radioByTag,
  radioTags,
  radioAddFavorite,
  radioRemoveFavorite,
  radioListFavorites,
  radioAddCustom,
  radioRemoveCustom,
  radioListCustom,
  radioPlay,
  radioStop,
  radioNowPlaying,
  radioListCached,
  radioSaveSegment,
  radioSaveLastSecs,
  type RadioStation,
  type RadioTag,
  type RadioNowPlaying,
  type CachedSegment,
} from "../lib/tauri-ipc";
import { escapeHtml, formatDuration } from "../lib/ui-utils";
import { listen } from "@tauri-apps/api/event";
import type Webamp from "webamp";

let panel: HTMLDivElement | null = null;
let visible = false;
let webampRef: Webamp | null = null;
let currentView: "browse" | "search" | "favorites" | "custom" | "playing" = "browse";
let cachedTags: RadioTag[] = [];
let isPlaying = false;
let nowPlaying: RadioNowPlaying | null = null;
let nowPlayingInterval: ReturnType<typeof setInterval> | null = null;

export function initRadioPanel(webamp: Webamp) {
  webampRef = webamp;
  // Listen for track changes from ICY metadata
  listen<RadioNowPlaying>("radio-track-change", (event) => {
    nowPlaying = event.payload;
    updateNowPlaying();
  });
}

export function toggleRadioPanel() {
  if (!panel) createPanel();
  visible = !visible;
  panel!.style.display = visible ? "flex" : "none";
  if (visible) {
    if (isPlaying) {
      renderPlaying();
    } else {
      renderBrowse();
    }
  }
}

function createPanel() {
  panel = document.createElement("div");
  panel.id = "radio-panel-overlay";
  panel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 560px; max-height: 85vh; background: #1a1a2e; border: 2px solid #444;
    border-radius: 8px; color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
    font-size: 11px; z-index: 10000; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;
  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#0f0;">Internet Radio</span>
      <div style="display:flex; gap:4px; align-items:center;">
        <span id="radio-live-badge" style="display:none; color:#f00; font-size:10px; font-weight:bold; animation: radio-blink 1s infinite;">LIVE</span>
        <button id="radio-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">&#x2715;</button>
      </div>
    </div>
    <div id="radio-nav" style="display:flex; gap:0; border-bottom:1px solid #333;">
      <button class="radio-nav-btn" data-view="browse" style="flex:1; padding:5px; background:#2a2a4a; border:none; border-bottom:2px solid #0f0; color:#0f0; cursor:pointer; font-family:inherit; font-size:10px;">Browse</button>
      <button class="radio-nav-btn" data-view="search" style="flex:1; padding:5px; background:#1a1a2e; border:none; border-bottom:2px solid transparent; color:#888; cursor:pointer; font-family:inherit; font-size:10px;">Search</button>
      <button class="radio-nav-btn" data-view="favorites" style="flex:1; padding:5px; background:#1a1a2e; border:none; border-bottom:2px solid transparent; color:#888; cursor:pointer; font-family:inherit; font-size:10px;">Favorites</button>
      <button class="radio-nav-btn" data-view="custom" style="flex:1; padding:5px; background:#1a1a2e; border:none; border-bottom:2px solid transparent; color:#888; cursor:pointer; font-family:inherit; font-size:10px;">Custom</button>
      <button class="radio-nav-btn" data-view="playing" style="flex:1; padding:5px; background:#1a1a2e; border:none; border-bottom:2px solid transparent; color:#888; cursor:pointer; font-family:inherit; font-size:10px;">Now Playing</button>
    </div>
    <div id="radio-content" style="padding: 12px; overflow-y: auto; max-height: calc(85vh - 80px);"></div>
  `;

  // Blinking animation
  const style = document.createElement("style");
  style.textContent = `
    @keyframes radio-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .radio-station-row:hover { background: #2a2a4a !important; }
    .radio-tag-btn:hover { background: #333 !important; border-color: #0f0 !important; }
  `;
  document.head.appendChild(style);

  document.body.appendChild(panel);

  panel.querySelector("#radio-close")!.addEventListener("click", () => toggleRadioPanel());

  panel.querySelectorAll(".radio-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = (btn as HTMLElement).dataset.view as typeof currentView;
      setActiveTab(view);
      switch (view) {
        case "browse": renderBrowse(); break;
        case "search": renderSearch(); break;
        case "favorites": renderFavorites(); break;
        case "custom": renderCustom(); break;
        case "playing": renderPlaying(); break;
      }
    });
  });
}

function setActiveTab(view: typeof currentView) {
  currentView = view;
  panel?.querySelectorAll(".radio-nav-btn").forEach((btn) => {
    const v = (btn as HTMLElement).dataset.view;
    const active = v === view;
    (btn as HTMLElement).style.background = active ? "#2a2a4a" : "#1a1a2e";
    (btn as HTMLElement).style.color = active ? "#0f0" : "#888";
    (btn as HTMLElement).style.borderBottom = active ? "2px solid #0f0" : "2px solid transparent";
  });
}

function content(): HTMLDivElement {
  return panel?.querySelector("#radio-content") as HTMLDivElement;
}

// ─── Browse by genre ───

async function renderBrowse() {
  const el = content();
  if (!el) return;
  setActiveTab("browse");

  el.innerHTML = '<div style="color:#888;">Loading genres...</div>';

  try {
    if (cachedTags.length === 0) {
      cachedTags = await radioTags();
    }

    // Group popular tags
    const popular = cachedTags.slice(0, 60);

    el.innerHTML = `
      <div style="margin-bottom:8px; color:#888; font-size:10px;">${cachedTags.length} genres available &mdash; click to browse stations</div>
      <div style="display:flex; flex-wrap:wrap; gap:4px;">
        ${popular.map((t) => `
          <button class="radio-tag-btn" data-tag="${escapeHtml(t.name)}" style="padding:4px 10px; background:#222; border:1px solid #444; color:#0f0; cursor:pointer; font-family:inherit; font-size:10px; border-radius:3px;">
            ${escapeHtml(t.name)} <span style="color:#555;">(${t.stationcount})</span>
          </button>
        `).join("")}
      </div>
    `;

    el.querySelectorAll(".radio-tag-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = (btn as HTMLElement).dataset.tag || "";
        renderStationsByTag(tag);
      });
    });
  } catch (e) {
    el.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

async function renderStationsByTag(tag: string) {
  const el = content();
  if (!el) return;

  el.innerHTML = '<div style="color:#888;">Loading stations...</div>';

  try {
    const stations = await radioByTag(tag, 100);
    renderStationList(el, stations, `${tag} (${stations.length} stations)`, () => renderBrowse());
  } catch (e) {
    el.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

// ─── Search ───

async function renderSearch() {
  const el = content();
  if (!el) return;
  setActiveTab("search");

  const lastQuery = localStorage.getItem("goamp_radio_query") || "";

  el.innerHTML = `
    <div style="display:flex; gap:6px; margin-bottom:10px;">
      <input id="radio-search-input" type="text" placeholder="Search stations..." value="${escapeHtml(lastQuery)}"
        style="flex:1; padding:5px 8px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
      <button id="radio-search-btn" style="padding:5px 12px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Search</button>
    </div>
    <div id="radio-search-results" style="color:#888; font-size:10px;">Type a station name and press Enter or Search</div>
  `;

  const input = el.querySelector("#radio-search-input") as HTMLInputElement;
  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    localStorage.setItem("goamp_radio_query", q);
    const results = el.querySelector("#radio-search-results") as HTMLDivElement;
    results.innerHTML = '<div style="color:#888;">Searching...</div>';
    try {
      const stations = await radioSearch(q, undefined, undefined, 50);
      renderStationList(results, stations, `Results for "${escapeHtml(q)}" (${stations.length})`);
    } catch (e) {
      results.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
  el.querySelector("#radio-search-btn")!.addEventListener("click", doSearch);
  setTimeout(() => input.focus(), 50);
}

// ─── Favorites ───

async function renderFavorites() {
  const el = content();
  if (!el) return;
  setActiveTab("favorites");

  el.innerHTML = '<div style="color:#888;">Loading favorites...</div>';

  try {
    const stations = await radioListFavorites();
    if (stations.length === 0) {
      el.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">No favorite stations yet. Browse or search to add some.</div>';
      return;
    }
    renderStationList(el, stations, `Favorites (${stations.length})`, undefined, true);
  } catch (e) {
    el.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

// ─── Custom stations ───

async function renderCustom() {
  const el = content();
  if (!el) return;
  setActiveTab("custom");

  el.innerHTML = '<div style="color:#888;">Loading...</div>';

  try {
    const stations = await radioListCustom();

    el.innerHTML = `
      <div style="border:1px solid #333; border-radius:4px; padding:10px; margin-bottom:10px;">
        <div style="font-weight:bold; color:#0f0; margin-bottom:6px;">Add Custom Station</div>
        <div style="display:flex; gap:4px; margin-bottom:4px;">
          <input id="radio-custom-name" type="text" placeholder="Station name"
            style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
          <input id="radio-custom-tags" type="text" placeholder="Genre (optional)"
            style="width:100px; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
        </div>
        <div style="display:flex; gap:4px;">
          <input id="radio-custom-url" type="text" placeholder="Stream URL (http://...)"
            style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
          <button id="radio-custom-add" style="padding:4px 10px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Add</button>
        </div>
      </div>
      <div id="radio-custom-list">
        ${stations.length === 0 ? '<div style="color:#888; text-align:center; padding:10px;">No custom stations</div>' : ""}
      </div>
    `;

    if (stations.length > 0) {
      const listEl = el.querySelector("#radio-custom-list") as HTMLDivElement;
      renderStationList(listEl, stations, `Custom Stations (${stations.length})`, undefined, false, true);
    }

    el.querySelector("#radio-custom-add")!.addEventListener("click", async () => {
      const name = (el.querySelector("#radio-custom-name") as HTMLInputElement).value.trim();
      const url = (el.querySelector("#radio-custom-url") as HTMLInputElement).value.trim();
      const tags = (el.querySelector("#radio-custom-tags") as HTMLInputElement).value.trim();
      if (!name || !url) return;
      try {
        await radioAddCustom(name, url, tags || undefined);
        renderCustom();
      } catch (e) {
        alert(`Error: ${e}`);
      }
    });
  } catch (e) {
    el.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

// ─── Now Playing ───

async function renderPlaying() {
  const el = content();
  if (!el) return;
  setActiveTab("playing");

  if (!isPlaying) {
    el.innerHTML = '<div style="color:#888; text-align:center; padding:30px;">No radio playing. Browse and select a station to start.</div>';
    return;
  }

  const np = nowPlaying;
  const segments = await radioListCached().catch(() => [] as CachedSegment[]);

  el.innerHTML = `
    <div style="border:1px solid #333; border-radius:4px; padding:12px; margin-bottom:10px; text-align:center;">
      <div style="color:#f00; font-size:12px; font-weight:bold; margin-bottom:4px; animation: radio-blink 1s infinite;">ON AIR</div>
      <div style="color:#0f0; font-size:14px; font-weight:bold; margin-bottom:4px;" id="radio-np-station">${escapeHtml(np?.station_name || "Unknown Station")}</div>
      <div style="color:#fc0; font-size:12px; margin-bottom:8px;" id="radio-np-title">${escapeHtml(np?.title || "Waiting for track info...")}</div>
      <div style="display:flex; gap:6px; justify-content:center;">
        <button id="radio-stop-btn" style="padding:5px 16px; background:#500; border:1px solid #800; color:#f00; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Stop</button>
        <button id="radio-save-30s" style="padding:5px 12px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Save last 30s</button>
        <button id="radio-save-60s" style="padding:5px 12px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Save last 60s</button>
      </div>
      <div id="radio-save-msg" style="color:#888; margin-top:6px; font-size:10px;"></div>
    </div>

    ${segments.length > 0 ? `
      <div style="margin-bottom:6px; color:#888; font-size:10px;">Cached tracks (click to save):</div>
      <div id="radio-segments">
        ${segments.map((s, i) => `
          <div class="radio-segment-row" data-idx="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:4px 6px; border-bottom:1px solid #222; cursor:pointer;">
            <div style="flex:1; min-width:0;">
              <span style="color:#0f0;">${escapeHtml(s.title)}</span>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <span style="color:#555; font-size:10px;">${formatDuration(s.duration_secs)}</span>
              <button class="radio-save-seg" data-idx="${i}" style="padding:2px 8px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-size:9px; border-radius:2px;">Save</button>
            </div>
          </div>
        `).join("")}
      </div>
    ` : '<div style="color:#555; font-size:10px;">No cached track segments yet. Track info appears as ICY metadata is received.</div>'}
  `;

  el.querySelector("#radio-stop-btn")!.addEventListener("click", async () => {
    await doStop();
    renderPlaying();
  });

  el.querySelector("#radio-save-30s")!.addEventListener("click", () => saveLastSecs(30));
  el.querySelector("#radio-save-60s")!.addEventListener("click", () => saveLastSecs(60));

  el.querySelectorAll(".radio-save-seg").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      try {
        const path = await radioSaveSegment(idx);
        showSaveMsg(`Saved: ${path}`);
      } catch (err) {
        showSaveMsg(`Error: ${err}`, true);
      }
    });
  });
}

async function saveLastSecs(secs: number) {
  try {
    const title = nowPlaying?.title || undefined;
    const path = await radioSaveLastSecs(secs, title);
    showSaveMsg(`Saved ${secs}s: ${path}`);
  } catch (e) {
    showSaveMsg(`Error: ${e}`, true);
  }
}

function showSaveMsg(msg: string, isError = false) {
  const el = panel?.querySelector("#radio-save-msg") as HTMLDivElement;
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? "#f00" : "#0f0";
  }
}

function updateNowPlaying() {
  const titleEl = panel?.querySelector("#radio-np-title");
  if (titleEl && nowPlaying) {
    titleEl.textContent = nowPlaying.title || "Waiting for track info...";
  }
  const stationEl = panel?.querySelector("#radio-np-station");
  if (stationEl && nowPlaying) {
    stationEl.textContent = nowPlaying.station_name;
  }
  // Update live badge
  const badge = panel?.querySelector("#radio-live-badge") as HTMLElement;
  if (badge) {
    badge.style.display = isPlaying ? "inline" : "none";
  }
}

// ─── Station list renderer ───

function renderStationList(
  container: HTMLElement,
  stations: RadioStation[],
  header?: string,
  onBack?: () => void,
  showRemoveFav = false,
  showRemoveCustom = false,
) {
  container.innerHTML = `
    ${header ? `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="color:#fc0; font-weight:bold;">${header}</span>
        ${onBack ? '<button class="radio-back-btn" style="padding:3px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:3px;">Back</button>' : ""}
      </div>
    ` : ""}
    <div style="max-height:50vh; overflow-y:auto;">
      ${stations.map((s, i) => `
        <div class="radio-station-row" data-idx="${i}" style="display:flex; align-items:center; padding:5px 6px; border-bottom:1px solid #222; cursor:pointer; gap:8px;">
          ${s.favicon ? `<img src="${escapeHtml(s.favicon)}" width="24" height="24" style="border-radius:3px; flex-shrink:0;" onerror="this.style.display='none'" />` : '<div style="width:24px; height:24px; background:#333; border-radius:3px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#555; font-size:14px;">&#x266B;</div>'}
          <div style="flex:1; min-width:0;">
            <div style="color:#0f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(s.name)}</div>
            <div style="color:#555; font-size:9px;">${escapeHtml(s.tags || s.country || "")} ${s.bitrate ? `&middot; ${s.bitrate}kbps` : ""} ${s.codec ? `&middot; ${s.codec}` : ""}</div>
          </div>
          <div style="display:flex; gap:3px; flex-shrink:0;">
            <button class="radio-play-btn" data-idx="${i}" style="padding:3px 8px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-size:10px; border-radius:3px;">&#x25B6;</button>
            ${showRemoveFav ? `<button class="radio-unfav-btn" data-uuid="${escapeHtml(s.stationuuid)}" style="padding:3px 6px; background:#333; border:1px solid #555; color:#f00; cursor:pointer; font-size:10px; border-radius:3px;">&#x2715;</button>` : `<button class="radio-fav-btn" data-idx="${i}" style="padding:3px 6px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-size:10px; border-radius:3px;">&#x2605;</button>`}
            ${showRemoveCustom ? `<button class="radio-del-custom" data-uuid="${escapeHtml(s.stationuuid)}" style="padding:3px 6px; background:#333; border:1px solid #555; color:#f00; cursor:pointer; font-size:10px; border-radius:3px;">&#x2715;</button>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;

  if (onBack) {
    container.querySelector(".radio-back-btn")?.addEventListener("click", onBack);
  }

  container.querySelectorAll(".radio-play-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      await doPlay(stations[idx]);
    });
  });

  container.querySelectorAll(".radio-fav-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      try {
        await radioAddFavorite(stations[idx]);
        (btn as HTMLElement).textContent = "\u2713";
        (btn as HTMLElement).style.color = "#0f0";
      } catch (err) {
        console.error("Failed to add favorite:", err);
      }
    });
  });

  container.querySelectorAll(".radio-unfav-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const uuid = (btn as HTMLElement).dataset.uuid || "";
      await radioRemoveFavorite(uuid);
      renderFavorites();
    });
  });

  container.querySelectorAll(".radio-del-custom").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const uuid = (btn as HTMLElement).dataset.uuid || "";
      // Custom stations have uuid like "custom:id"
      const id = uuid.replace("custom:", "");
      await radioRemoveCustom(id);
      renderCustom();
    });
  });
}

// ─── Play/Stop ───

async function doPlay(station: RadioStation) {
  try {
    const proxyUrl = await radioPlay(station);
    isPlaying = true;
    nowPlaying = { title: "", station_name: station.name, station_uuid: station.stationuuid };

    // Set the stream in Webamp
    if (webampRef) {
      webampRef.setTracksToPlay([
        {
          metaData: { artist: station.name, title: "Radio Stream" },
          url: proxyUrl,
          duration: 0,
        },
      ]);
    }

    updateNowPlaying();

    // Auto switch to "Now Playing" tab
    renderPlaying();

    // Start polling for track info
    if (nowPlayingInterval) clearInterval(nowPlayingInterval);
    nowPlayingInterval = setInterval(async () => {
      if (!isPlaying) {
        if (nowPlayingInterval) clearInterval(nowPlayingInterval);
        return;
      }
      try {
        const np = await radioNowPlaying();
        if (np) {
          nowPlaying = np;
          updateNowPlaying();
        }
      } catch {
        // ignore
      }
    }, 5000);
  } catch (e) {
    alert(`Failed to play: ${e}`);
  }
}

async function doStop() {
  isPlaying = false;
  nowPlaying = null;
  if (nowPlayingInterval) {
    clearInterval(nowPlayingInterval);
    nowPlayingInterval = null;
  }
  await radioStop().catch(() => {});
  updateNowPlaying();
}
