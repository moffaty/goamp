import {
  yandexSaveToken,
  yandexGetStatus,
  yandexLogout,
  yandexListStations,
  yandexStationTracks,
  yandexGetTrackUrl,
  yandexListPlaylists,
  yandexGetPlaylistTracks,
  yandexImportPlaylist,
  type YandexStation,
  type YandexPlaylist,
  type YandexAccount,
} from "./yandex-service";
import { openUrl } from "@tauri-apps/plugin-opener";
import type Webamp from "webamp";

let panel: HTMLDivElement | null = null;
let visible = false;
let webampInstance: Webamp | null = null;

// State
let account: YandexAccount | null = null;
let stations: YandexStation[] = [];
let playlists: YandexPlaylist[] = [];
let currentView: "auth" | "main" | "stations" | "playlist" = "auth";


export function initYandexPanel(webamp: Webamp) {
  webampInstance = webamp;
}

export function toggleYandexPanel() {
  if (!panel) createPanel();
  visible = !visible;
  panel!.style.display = visible ? "flex" : "none";
  if (visible) refreshStatus();
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
    case "playlist":
      break;
  }
}

function renderAuth(el: HTMLDivElement) {
  el.innerHTML = `
    <div style="margin-bottom:10px; color:#aaa;">
      Enter your Yandex Music OAuth token to connect.
    </div>
    <div style="margin-bottom:6px; color:#666; font-size:10px;">
      Get token: open Yandex OAuth page, authorize, copy access_token from redirect URL.
    </div>
    <div style="display:flex; gap:6px; margin-bottom:10px;">
      <input id="ya-token-input" type="text" placeholder="OAuth token" style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#fc0; font-family:inherit; font-size:11px; border-radius:3px;" />
      <button id="ya-connect-btn" style="padding:5px 12px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Connect</button>
    </div>
    <div style="margin-bottom:8px;">
      <button id="ya-oauth-btn" style="padding:5px 12px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px; width:100%;">Open Yandex OAuth Page</button>
    </div>
    <div id="ya-auth-status" style="color:#888;"></div>
  `;

  el.querySelector("#ya-oauth-btn")!.addEventListener("click", () => {
    openUrl(
      "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d",
    );
  });

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
      <button class="ya-action-btn" data-action="wave" style="flex:1; min-width:120px; padding:8px; background:#2a2a4a; border:1px solid #555; color:#fc0; cursor:pointer; font-family:inherit; font-size:12px; border-radius:4px; font-weight:bold;">
        Moя Волна
      </button>
      <button class="ya-action-btn" data-action="stations" style="flex:1; min-width:120px; padding:8px; background:#2a2a4a; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:12px; border-radius:4px;">
        Радио / Жанры
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
  } catch (e) {
    list.textContent = `Error: ${e}`;
    list.style.color = "#f00";
  }
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

async function playStation(stationId: string, name: string) {
  if (!webampInstance) return;

  try {
    const tracks = await yandexStationTracks(stationId, undefined);
    if (tracks.length === 0) {
      console.warn("[GOAMP] No tracks from station:", stationId);
      return;
    }

    const webampTracks = await Promise.all(
      tracks.map(async (t) => {
        const url = await yandexGetTrackUrl(t.id);
        return {
          metaData: { artist: t.artist || "Unknown", title: t.title },
          url,
          duration: t.duration,
        };
      }),
    );

    webampInstance.setTracksToPlay(webampTracks);
    console.log(`[GOAMP] Playing station "${name}": ${tracks.length} tracks`);

    // Close panel after starting playback
    if (visible) toggleYandexPanel();
  } catch (e) {
    console.error("[GOAMP] Station play failed:", e);
  }
}

async function playYandexPlaylist(pl: YandexPlaylist) {
  if (!webampInstance) return;

  try {
    const tracks = await yandexGetPlaylistTracks(pl.owner, pl.kind);
    if (tracks.length === 0) return;

    const webampTracks = await Promise.all(
      tracks.slice(0, 50).map(async (t) => {
        const url = await yandexGetTrackUrl(t.id);
        return {
          metaData: { artist: t.artist || "Unknown", title: t.title },
          url,
          duration: t.duration,
        };
      }),
    );

    webampInstance.setTracksToPlay(webampTracks);
    console.log(`[GOAMP] Playing Yandex playlist "${pl.title}": ${webampTracks.length} tracks`);

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
