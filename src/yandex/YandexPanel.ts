import {
  yandexSaveToken,
  yandexGetStatus,
  yandexLogout,
  yandexRequestDeviceCode,
  yandexPollToken,
  yandexListStations,
  yandexStationTracks,
  yandexGetTrackUrl,
  yandexListPlaylists,
  yandexGetPlaylistTracks,
  yandexImportPlaylist,
  yandexDownloadPlaylist,
  yandexGetLikedTracks,
  yandexOpenOAuthWindow,
  yandexLikeTrack,
  yandexDownloadToLibrary,
  type YandexStation,
  type YandexPlaylist,
  type YandexTrack,
  type YandexAccount,
} from "./yandex-service";
import {
  addTrackToPlaylist,
  listPlaylists,
  createPlaylist,
} from "../lib/tauri-ipc";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type Webamp from "webamp";

let panel: HTMLDivElement | null = null;
let visible = false;
let webampInstance: Webamp | null = null;

// State
let account: YandexAccount | null = null;
let stations: YandexStation[] = [];
let playlists: YandexPlaylist[] = [];
let currentView: "auth" | "main" | "stations" | "playlist" | "liked" = "auth";
let likedTracks: YandexTrack[] = [];


export function initYandexPanel(webamp: Webamp) {
  webampInstance = webamp;

  // Listen for OAuth success from Tauri backend
  const webview = getCurrentWebviewWindow();
  webview.listen("yandex-auth-success", () => {
    refreshStatus();
  });
}

export function toggleYandexPanel() {
  if (!panel) createPanel();
  visible = !visible;
  panel!.style.display = visible ? "flex" : "none";
  if (visible) {
    refreshStatus();
  } else {
    // Clean up polling timer when panel is hidden
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
}

function createPanel() {
  panel = document.createElement("div");
  panel.id = "yandex-panel-overlay";
  panel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 520px; max-height: 80vh; background: #1a1a2e; border: 2px solid #444;
    border-radius: 8px; color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
    font-size: 11px; z-index: 10000; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;

  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#fc0;">Yandex Music</span>
      <button id="ya-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div id="ya-content" style="padding: 12px; overflow-y: auto; max-height: calc(80vh - 40px);"></div>
  `;

  document.body.appendChild(panel);
  panel.querySelector("#ya-close")!.addEventListener("click", () => toggleYandexPanel());
}

async function refreshStatus() {
  try {
    account = await yandexGetStatus();
    if (account) {
      currentView = "main";
    } else {
      currentView = "auth";
    }
  } catch {
    currentView = "auth";
  }
  render();
}

function render() {
  const content = panel?.querySelector("#ya-content") as HTMLDivElement;
  if (!content) return;

  switch (currentView) {
    case "auth":
      renderAuth(content);
      break;
    case "main":
      renderMain(content);
      break;
    case "stations":
      renderStations(content);
      break;
    case "liked":
      renderLiked(content);
      break;
    case "playlist":
      break;
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function renderAuth(el: HTMLDivElement) {
  el.innerHTML = `
    <div style="margin-bottom:12px; color:#aaa;">
      Sign in with your Yandex account to access music, playlists, and radio.
    </div>
    <div style="margin-bottom:10px;">
      <button id="ya-oauth-btn" style="padding:8px 12px; background:#fc0; border:none; color:#000; cursor:pointer; font-family:inherit; font-size:12px; border-radius:4px; width:100%; font-weight:bold;">Sign in with Yandex</button>
    </div>
    <div id="ya-auth-status" style="color:#888; margin-top:8px; text-align:center;"></div>
    <details style="margin-top:12px;">
      <summary style="color:#666; cursor:pointer; font-size:10px;">Device code / manual token</summary>
      <div style="margin-top:8px;">
        <button id="ya-device-btn" style="padding:5px 10px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px; width:100%; margin-bottom:6px;">Use device code flow</button>
        <div id="ya-device-code-area" style="display:none; margin-top:8px; padding:8px; background:#111; border:1px solid #333; border-radius:4px; text-align:center;">
          <div style="color:#aaa; margin-bottom:4px; font-size:10px;">Open the link and enter this code:</div>
          <div id="ya-user-code" style="font-size:22px; color:#fc0; font-weight:bold; letter-spacing:4px; margin:6px 0;"></div>
          <button id="ya-open-url" style="padding:4px 10px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:10px; border-radius:3px;">Open Yandex login page</button>
          <div style="color:#666; margin-top:4px; font-size:9px;">Waiting for authorization...</div>
        </div>
        <div style="display:flex; gap:6px; margin-top:6px;">
          <input id="ya-token-input" type="text" placeholder="OAuth token" style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#fc0; font-family:inherit; font-size:11px; border-radius:3px;" />
          <button id="ya-connect-btn" style="padding:5px 10px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Connect</button>
        </div>
      </div>
    </details>
  `;

  // Primary: WebView OAuth (automatic token extraction)
  el.querySelector("#ya-oauth-btn")!.addEventListener("click", async () => {
    const status = el.querySelector("#ya-auth-status") as HTMLDivElement;
    status.textContent = "Opening sign-in window...";
    status.style.color = "#fc0";
    try {
      await yandexOpenOAuthWindow();
      status.textContent = "Sign in to Yandex in the opened window";
      status.style.color = "#aaa";
    } catch (e) {
      status.textContent = `Error: ${e}`;
      status.style.color = "#f00";
    }
  });

  // Fallback: device code
  el.querySelector("#ya-device-btn")!.addEventListener("click", async () => {
    const status = el.querySelector("#ya-auth-status") as HTMLDivElement;
    const codeArea = el.querySelector("#ya-device-code-area") as HTMLDivElement;
    const codeEl = el.querySelector("#ya-user-code") as HTMLDivElement;
    status.textContent = "Requesting code...";
    status.style.color = "#fc0";
    try {
      const resp = await yandexRequestDeviceCode();
      codeEl.textContent = resp.user_code;
      codeArea.style.display = "block";
      status.textContent = "";

      el.querySelector("#ya-open-url")!.addEventListener("click", () => {
        openUrl(resp.verification_url);
      });
      openUrl(resp.verification_url);

      if (pollTimer) clearInterval(pollTimer);
      const interval = Math.max(resp.interval, 2) * 1000;
      pollTimer = setInterval(async () => {
        try {
          await yandexPollToken(resp.device_code);
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          refreshStatus();
        } catch (e) {
          const err = String(e);
          if (!err.includes("pending")) {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            status.textContent = `Error: ${err}`;
            status.style.color = "#f00";
            codeArea.style.display = "none";
          }
        }
      }, interval);
    } catch (e) {
      status.textContent = `Error: ${e}`;
      status.style.color = "#f00";
    }
  });

  // Manual token
  el.querySelector("#ya-connect-btn")!.addEventListener("click", async () => {
    const input = el.querySelector("#ya-token-input") as HTMLInputElement;
    const token = input.value.trim();
    if (!token) return;
    const status = el.querySelector("#ya-auth-status") as HTMLDivElement;
    status.textContent = "Connecting...";
    status.style.color = "#fc0";
    try {
      await yandexSaveToken(token);
      account = await yandexGetStatus();
      if (account) {
        currentView = "main";
        render();
      } else {
        status.textContent = "Invalid token";
        status.style.color = "#f00";
      }
    } catch (e) {
      status.textContent = `Error: ${e}`;
      status.style.color = "#f00";
    }
  });
}

function renderMain(el: HTMLDivElement) {
  const name = account?.display_name || account?.login || "User";
  const plus = account?.has_plus ? ' <span style="color:#fc0;">[Plus]</span>' : "";

  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <span>${name}${plus}</span>
      <button id="ya-logout" style="padding:3px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-family:inherit; font-size:10px; border-radius:3px;">Logout</button>
    </div>
    <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
      <button class="ya-action-btn" data-action="wave" style="flex:1; min-width:100px; padding:8px; background:#2a2a4a; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:12px; border-radius:4px; font-weight:bold;">
        Moя Волна
      </button>
      <button class="ya-action-btn" data-action="stations" style="flex:1; min-width:100px; padding:8px; background:#2a2a4a; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:12px; border-radius:4px;">
        Радио / Жанры
      </button>
      <button class="ya-action-btn" data-action="liked" style="flex:1; min-width:100px; padding:8px; background:#2a2a4a; border:1px solid #555; color:#f55; cursor:pointer; font-family:inherit; font-size:12px; border-radius:4px;">
        ♥ Мне нравится
      </button>
    </div>
    <div style="border-top:1px solid #333; padding-top:10px; margin-top:4px;">
      <div style="color:#aaa; margin-bottom:6px; font-weight:bold;">Playlists</div>
      <div id="ya-playlists-list" style="color:#888;">Loading...</div>
    </div>
  `;

  el.querySelector("#ya-logout")!.addEventListener("click", async () => {
    await yandexLogout();
    account = null;
    currentView = "auth";
    render();
  });

  el.querySelector('[data-action="wave"]')!.addEventListener("click", () => {
    playStation("user:onyourwave", "Моя Волна");
  });

  el.querySelector('[data-action="stations"]')!.addEventListener("click", async () => {
    currentView = "stations";
    stations = [];
    render();
    try {
      stations = await yandexListStations();
      renderStations(el);
    } catch (e) {
      el.querySelector("#ya-content")!.innerHTML += `<div style="color:#f00;">Error: ${e}</div>`;
    }
  });

  el.querySelector('[data-action="liked"]')!.addEventListener("click", async () => {
    currentView = "liked";
    likedTracks = [];
    render();
    try {
      likedTracks = await yandexGetLikedTracks();
      renderLiked(el);
    } catch (e) {
      el.innerHTML += `<div style="color:#f00;">Error: ${e}</div>`;
    }
  });

  // Now playing: show like button if Yandex track
  renderNowPlaying(el);

  // Load playlists
  loadPlaylists(el);
}

async function loadPlaylists(el: HTMLDivElement) {
  const list = el.querySelector("#ya-playlists-list") as HTMLDivElement;
  if (!list) return;

  try {
    playlists = await yandexListPlaylists();
    if (playlists.length === 0) {
      list.textContent = "No playlists";
      return;
    }
    list.innerHTML = playlists
      .map(
        (p, i) => `
        <div class="ya-playlist-item" data-idx="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:4px 6px; cursor:pointer; border-bottom:1px solid #222;">
          <span style="color:#0f0;">${escapeHtml(p.title)} <span style="color:#666;">(${p.track_count})</span></span>
          <div style="display:flex; gap:4px;">
            <button class="ya-pl-play" data-idx="${i}" style="padding:2px 6px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-size:10px; border-radius:2px;">Play</button>
            <button class="ya-pl-import" data-idx="${i}" style="padding:2px 6px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-size:10px; border-radius:2px;">Import</button>
            <button class="ya-pl-download" data-idx="${i}" style="padding:2px 6px; background:#333; border:1px solid #555; color:#88f; cursor:pointer; font-size:10px; border-radius:2px;">↓</button>
          </div>
        </div>
      `,
      )
      .join("");

    list.querySelectorAll(".ya-pl-play").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
        playYandexPlaylist(playlists[idx]);
      });
    });

    list.querySelectorAll(".ya-pl-import").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
        const pl = playlists[idx];
        try {
          (btn as HTMLElement).textContent = "...";
          await yandexImportPlaylist(pl.owner, pl.kind, pl.title);
          (btn as HTMLElement).textContent = "Done!";
          (btn as HTMLElement).style.color = "#0f0";
        } catch (err) {
          (btn as HTMLElement).textContent = "Err";
          (btn as HTMLElement).style.color = "#f00";
          console.error("[GOAMP] Import failed:", err);
        }
      });
    });

    list.querySelectorAll(".ya-pl-download").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
        const pl = playlists[idx];
        try {
          (btn as HTMLElement).textContent = "...";
          const paths = await yandexDownloadPlaylist(pl.owner, pl.kind);
          (btn as HTMLElement).textContent = `${paths.length}✓`;
          (btn as HTMLElement).style.color = "#0f0";
        } catch (err) {
          (btn as HTMLElement).textContent = "Err";
          (btn as HTMLElement).style.color = "#f00";
          console.error("[GOAMP] Download failed:", err);
        }
      });
    });
  } catch (e) {
    list.textContent = `Error: ${e}`;
    list.style.color = "#f00";
  }
}

async function addYandexTrackToGoampPlaylist(t: YandexTrack): Promise<void> {
  // Use last selected GOAMP playlist, or create "Yandex Liked" if none
  let playlistId = localStorage.getItem("goamp_last_playlist_id");
  if (!playlistId) {
    const all = await listPlaylists();
    let target = all.find((p) => p.name === "Yandex Liked");
    if (!target) {
      target = await createPlaylist("Yandex Liked");
    }
    playlistId = target.id;
    localStorage.setItem("goamp_last_playlist_id", playlistId);
  }

  await addTrackToPlaylist(playlistId, {
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    source: "yandex",
    source_id: t.id,
    album: t.album,
    cover: t.cover,
  });
}

function renderNowPlaying(el: HTMLDivElement) {
  const store = (webampInstance as any)?.store;
  if (!store) return;
  const state = store.getState();
  const tracks = state?.playlist?.tracks || {};
  const currentId = state?.playlist?.currentTrack;
  const current = currentId ? tracks[currentId] : null;
  if (!current) return;

  const url: string = current.url || "";
  const yaMatch = url.match(/#ya:(\d+)$/);
  if (!yaMatch) return; // only show for Yandex tracks

  const trackId = yaMatch[1];
  const title = current.title || current.defaultName || "Unknown";
  const artist = current.artist || "";

  // Insert now-playing section before playlists border
  const nowPlaying = document.createElement("div");
  nowPlaying.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 0 10px; border-bottom:1px solid #333; margin-bottom:8px;";
  nowPlaying.innerHTML = `
    <div style="flex:1; min-width:0;">
      <div style="color:#888; font-size:9px; text-transform:uppercase; letter-spacing:1px;">Now Playing</div>
      <div style="color:#0f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(title)}</div>
      <div style="color:#666; font-size:10px;">${escapeHtml(artist)}</div>
    </div>
    <button id="ya-like-now" data-id="${trackId}" style="padding:4px 8px; background:#333; border:1px solid #555; color:#f55; cursor:pointer; font-size:14px; border-radius:3px;" title="Like this track">♥</button>
  `;
  el.insertBefore(nowPlaying, el.querySelector('[style*="border-top"]') || el.firstChild);

  el.querySelector("#ya-like-now")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.textContent = "...";
    try {
      await yandexLikeTrack(trackId, true);
      btn.textContent = "♥";
      btn.style.color = "#0f0";
      btn.style.border = "1px solid #0f0";
      btn.title = "Liked!";
    } catch (err) {
      btn.textContent = "♥";
      btn.style.color = "#f55";
      console.error("[GOAMP] Like failed:", err);
    }
  });
}

function renderStations(el: HTMLDivElement) {
  // Filter to genre stations for cleaner UI
  const genreStations = stations.filter(
    (s) => s.id.startsWith("genre:") || s.id === "user:onyourwave",
  );

  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <span style="color:#fc0; font-weight:bold;">Радио / Жанры</span>
      <button id="ya-back-main" style="padding:3px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:3px;">Back</button>
    </div>
    <div id="ya-stations-grid" style="display:flex; flex-wrap:wrap; gap:6px;">
      ${genreStations
        .map(
          (s) => `
        <button class="ya-station-btn" data-id="${s.id}" style="padding:6px 10px; background:#2a2a4a; border:1px solid #444; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:4px; min-width:100px; text-align:center;">
          ${escapeHtml(s.name)}
        </button>
      `,
        )
        .join("")}
    </div>
  `;

  el.querySelector("#ya-back-main")!.addEventListener("click", () => {
    currentView = "main";
    render();
  });

  el.querySelectorAll(".ya-station-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id!;
      const name = (btn as HTMLElement).textContent?.trim() || id;
      playStation(id, name);
    });
  });
}

function renderLiked(el: HTMLDivElement) {
  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <span style="color:#f55; font-weight:bold;">♥ Мне нравится (${likedTracks.length})</span>
      <div style="display:flex; gap:4px;">
        <button id="ya-liked-play-all" style="padding:3px 8px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-size:10px; border-radius:3px;">Play All</button>
        <button id="ya-back-main2" style="padding:3px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:3px;">Back</button>
      </div>
    </div>
    <div id="ya-liked-list" style="max-height:60vh; overflow-y:auto;">
      ${likedTracks.length === 0 ? '<div style="color:#888;">Loading...</div>' : likedTracks
        .map(
          (t, i) => `
        <div class="ya-liked-item" data-idx="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; border-bottom:1px solid #222;">
          <div style="flex:1; min-width:0;">
            <span style="color:#0f0;">${escapeHtml(t.title)}</span>
            <span style="color:#666;"> — ${escapeHtml(t.artist)}</span>
          </div>
          <div style="display:flex; gap:3px; flex-shrink:0;">
            <button class="ya-liked-play" data-idx="${i}" style="padding:1px 5px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-size:9px; border-radius:2px;">▶</button>
            <button class="ya-liked-add" data-idx="${i}" style="padding:1px 5px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-size:9px; border-radius:2px;" title="Add to playlist (stream)">+</button>
            <button class="ya-liked-dl" data-idx="${i}" style="padding:1px 5px; background:#333; border:1px solid #555; color:#88f; cursor:pointer; font-size:9px; border-radius:2px;" title="Download & save locally">↓</button>
            <button class="ya-unlike-btn" data-idx="${i}" style="padding:1px 5px; background:#333; border:1px solid #555; color:#f55; cursor:pointer; font-size:9px; border-radius:2px;" title="Unlike">♥</button>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  el.querySelector("#ya-back-main2")!.addEventListener("click", () => {
    currentView = "main";
    render();
  });

  el.querySelector("#ya-liked-play-all")!.addEventListener("click", async () => {
    if (likedTracks.length === 0) return;
    cleanupAutoLoad();
    const firstBatch = likedTracks.slice(0, BATCH_SIZE);
    playlistPendingTracks = likedTracks.slice(BATCH_SIZE);
    const webampTracks = await resolveTrackUrls(firstBatch);
    webampInstance?.setTracksToPlay(webampTracks);
    setupAutoLoad();
    console.log(`[GOAMP] Playing liked: ${firstBatch.length} loaded, ${playlistPendingTracks.length} queued`);
    if (visible) toggleYandexPanel();
  });

  // Play single track (replaces playlist)
  el.querySelectorAll(".ya-liked-play").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      const t = likedTracks[idx];
      try {
        const url = await yandexGetTrackUrl(t.id);
        webampInstance?.setTracksToPlay([{
          metaData: { artist: t.artist || "Unknown", title: t.title },
          url: `${url}#ya:${t.id}`,
          duration: t.duration,
        }]);
        if (visible) toggleYandexPanel();
      } catch (err) {
        console.error("[GOAMP] Play liked track failed:", err);
      }
    });
  });

  // Add single track to GOAMP playlist (saves to SQLite, no download)
  el.querySelectorAll(".ya-liked-add").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      const t = likedTracks[idx];
      try {
        (btn as HTMLElement).textContent = "...";
        await addYandexTrackToGoampPlaylist(t);
        (btn as HTMLElement).textContent = "✓";
        (btn as HTMLElement).style.color = "#0f0";
      } catch (err) {
        (btn as HTMLElement).textContent = "!";
        (btn as HTMLElement).style.color = "#f00";
        console.error("[GOAMP] Add to playlist failed:", err);
      }
    });
  });

  // Download track to local library
  el.querySelectorAll(".ya-liked-dl").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      const t = likedTracks[idx];
      try {
        (btn as HTMLElement).textContent = "…";
        (btn as HTMLElement).style.color = "#aaa";
        const filePath = await yandexDownloadToLibrary(t.id, t.title, t.artist);
        // Add to GOAMP playlist with local source so it plays without Yandex
        const playlists = await listPlaylists();
        let playlistId: string;
        const stored = localStorage.getItem("goamp_last_playlist_id");
        const found = stored ? playlists.find((p) => p.id === stored) : null;
        if (found) {
          playlistId = found.id;
        } else {
          const existing = playlists.find((p) => p.name === "Yandex Liked");
          playlistId = existing ? existing.id : (await createPlaylist("Yandex Liked")).id;
          localStorage.setItem("goamp_last_playlist_id", playlistId);
        }
        await addTrackToPlaylist(playlistId, {
          title: t.title,
          artist: t.artist,
          duration: t.duration,
          source: "local",
          source_id: filePath,
          original_title: t.title,
          original_artist: t.artist,
        });
        (btn as HTMLElement).textContent = "✓";
        (btn as HTMLElement).style.color = "#0f0";
      } catch (err) {
        (btn as HTMLElement).textContent = "!";
        (btn as HTMLElement).style.color = "#f00";
        console.error("[GOAMP] Download failed:", err);
      }
    });
  });

  // Unlike button
  el.querySelectorAll(".ya-unlike-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "0");
      const t = likedTracks[idx];
      try {
        (btn as HTMLElement).textContent = "...";
        await yandexLikeTrack(t.id, false);
        // Remove from list
        likedTracks.splice(idx, 1);
        renderLiked(el);
      } catch (err) {
        (btn as HTMLElement).textContent = "♥";
        console.error("[GOAMP] Unlike failed:", err);
      }
    });
  });
}

// ─── Lazy loading / auto-reload state ───
const BATCH_SIZE = 20;
let activeStationId: string | null = null;
let activeStationLastTrackId: string | undefined = undefined;
let stationLoadingMore = false;
let playlistPendingTracks: { id: string; artist: string; title: string; duration: number }[] = [];
let playlistLoadingMore = false;
let trackChangeUnsub: (() => void) | null = null;

async function resolveTrackUrls(
  tracks: { id: string; artist: string; title: string; duration: number }[],
) {
  return Promise.all(
    tracks.map(async (t) => {
      const url = await yandexGetTrackUrl(t.id);
      return {
        metaData: { artist: t.artist || "Unknown", title: t.title },
        // Append #ya:{id} fragment so session save can extract the track ID
        url: `${url}#ya:${t.id}`,
        duration: t.duration,
      };
    }),
  );
}

function cleanupAutoLoad() {
  if (trackChangeUnsub) {
    trackChangeUnsub();
    trackChangeUnsub = null;
  }
  activeStationId = null;
  playlistPendingTracks = [];
}

function setupAutoLoad() {
  if (trackChangeUnsub || !webampInstance) return;

  trackChangeUnsub = webampInstance.onTrackDidChange(() => {
    const store = (webampInstance as any)?.store;
    if (!store) return;
    const state = store.getState();
    const order: string[] = state?.playlist?.trackOrder || [];
    const currentIndex = order.indexOf(state?.playlist?.currentTrack);
    const remaining = order.length - currentIndex - 1;

    // Load more when 3 or fewer tracks remain
    if (remaining <= 3) {
      if (activeStationId && !stationLoadingMore) {
        loadMoreStationTracks();
      } else if (playlistPendingTracks.length > 0 && !playlistLoadingMore) {
        loadMorePlaylistTracks();
      }
    }
  });
}

async function loadMoreStationTracks() {
  if (!webampInstance || !activeStationId || stationLoadingMore) return;
  stationLoadingMore = true;

  try {
    const tracks = await yandexStationTracks(activeStationId, activeStationLastTrackId);
    if (tracks.length === 0) {
      stationLoadingMore = false;
      return;
    }
    activeStationLastTrackId = tracks[tracks.length - 1].id;

    const webampTracks = await resolveTrackUrls(tracks);
    if (typeof (webampInstance as any).appendTracks === "function") {
      (webampInstance as any).appendTracks(webampTracks);
    } else {
      // Fallback: dispatch ADD_TRACK_FROM_URL actions
      const store = (webampInstance as any).store;
      if (store) {
        for (const t of webampTracks) {
          store.dispatch({ type: "ADD_TRACK_FROM_URL", url: t.url, defaultName: t.metaData?.title || "Unknown", duration: t.duration });
        }
      }
    }
    console.log(`[GOAMP] Appended ${tracks.length} station tracks`);
  } catch (e) {
    console.error("[GOAMP] Station auto-load failed:", e);
  }
  stationLoadingMore = false;
}

async function loadMorePlaylistTracks() {
  if (!webampInstance || playlistPendingTracks.length === 0 || playlistLoadingMore) return;
  playlistLoadingMore = true;

  try {
    const batch = playlistPendingTracks.splice(0, BATCH_SIZE);
    const webampTracks = await resolveTrackUrls(batch);
    if (typeof (webampInstance as any).appendTracks === "function") {
      (webampInstance as any).appendTracks(webampTracks);
    } else {
      const store = (webampInstance as any).store;
      if (store) {
        for (const t of webampTracks) {
          store.dispatch({ type: "ADD_TRACK_FROM_URL", url: t.url, defaultName: t.metaData?.title || "Unknown", duration: t.duration });
        }
      }
    }
    console.log(`[GOAMP] Appended ${batch.length} playlist tracks (${playlistPendingTracks.length} remaining)`);
  } catch (e) {
    console.error("[GOAMP] Playlist auto-load failed:", e);
  }
  playlistLoadingMore = false;
}

async function playStation(stationId: string, name: string) {
  if (!webampInstance) return;

  try {
    // Clean up previous auto-load before starting new source
    cleanupAutoLoad();
    activeStationId = stationId;
    activeStationLastTrackId = undefined;

    const tracks = await yandexStationTracks(stationId, undefined);
    if (tracks.length === 0) {
      console.warn("[GOAMP] No tracks from station:", stationId);
      return;
    }
    activeStationLastTrackId = tracks[tracks.length - 1].id;

    const webampTracks = await resolveTrackUrls(tracks);
    webampInstance.setTracksToPlay(webampTracks);
    setupAutoLoad();
    console.log(`[GOAMP] Playing station "${name}": ${tracks.length} tracks (auto-reload on)`);
    // Pre-load next batch immediately so there are enough tracks in queue
    loadMoreStationTracks();

    if (visible) toggleYandexPanel();
  } catch (e) {
    console.error("[GOAMP] Station play failed:", e);
  }
}

async function playYandexPlaylist(pl: YandexPlaylist) {
  if (!webampInstance) return;

  try {
    // Clean up previous auto-load before starting new source
    cleanupAutoLoad();

    const allTracks = await yandexGetPlaylistTracks(pl.owner, pl.kind);
    if (allTracks.length === 0) return;

    // Load first batch, queue the rest
    const firstBatch = allTracks.slice(0, BATCH_SIZE);
    playlistPendingTracks = allTracks.slice(BATCH_SIZE);

    const webampTracks = await resolveTrackUrls(firstBatch);
    webampInstance.setTracksToPlay(webampTracks);
    setupAutoLoad();
    console.log(`[GOAMP] Playing Yandex playlist "${pl.title}": ${firstBatch.length} loaded, ${playlistPendingTracks.length} queued`);

    if (visible) toggleYandexPanel();
  } catch (e) {
    console.error("[GOAMP] Playlist play failed:", e);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
