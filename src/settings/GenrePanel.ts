import {
  listGenres,
  getTracksByGenre,
  youtubeSetCookies,
  youtubeGetCookies,
  youtubeClearCookies,
  youtubeGetPlaylist,
  type PlaylistTrack,
} from "../lib/tauri-ipc";
import { extractAudio, extractAudioUrl } from "../youtube/youtube-service";
import { convertFileSrc } from "@tauri-apps/api/core";
import { escapeHtml, formatDuration } from "../lib/ui-utils";
import { open } from "@tauri-apps/plugin-dialog";
import type Webamp from "webamp";

let panel: HTMLDivElement | null = null;
let visible = false;
let webampRef: Webamp | null = null;

export function initGenrePanel(webamp: Webamp) {
  webampRef = webamp;
}

export function toggleGenrePanel() {
  if (!panel) createPanel();
  visible = !visible;
  panel!.style.display = visible ? "flex" : "none";
  if (visible) renderGenreList();
}

function createPanel() {
  panel = document.createElement("div");
  panel.id = "genre-panel-overlay";
  panel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 500px; max-height: 80vh; background: #1a1a2e; border: 2px solid #444;
    border-radius: 8px; color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
    font-size: 11px; z-index: 10000; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;
  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#0f0;">Genre Browser</span>
      <button id="genre-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div id="genre-content" style="padding: 12px; overflow-y: auto; max-height: calc(80vh - 40px);"></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#genre-close")!.addEventListener("click", () => toggleGenrePanel());
}

async function renderGenreList() {
  const content = panel?.querySelector("#genre-content") as HTMLDivElement;
  if (!content) return;

  content.innerHTML = '<div style="color:#888;">Loading genres...</div>';

  try {
    const genres = await listGenres();
    if (genres.length === 0) {
      content.innerHTML = `
        <div style="color:#888; text-align:center; padding:20px;">
          <div style="margin-bottom:8px;">No genres found yet.</div>
          <div style="font-size:10px; color:#666;">Genres are collected from your tracks. Import playlists from SoundCloud or YouTube to see genres here.</div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div style="margin-bottom:10px; color:#888; font-size:10px;">${genres.length} genre(s) in your library</div>
      <div id="genre-grid" style="display:flex; flex-wrap:wrap; gap:6px;">
        ${genres.map((g) => `
          <button class="genre-btn" data-genre="${escapeHtml(g)}" style="padding:6px 12px; background:#2a2a4a; border:1px solid #444; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:4px;">
            ${escapeHtml(g)}
          </button>
        `).join("")}
      </div>
    `;

    content.querySelectorAll(".genre-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const genre = (btn as HTMLElement).dataset.genre || "";
        renderGenreTracks(genre);
      });
    });
  } catch (e) {
    content.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

async function renderGenreTracks(genre: string) {
  const content = panel?.querySelector("#genre-content") as HTMLDivElement;
  if (!content) return;

  content.innerHTML = '<div style="color:#888;">Loading tracks...</div>';

  try {
    const tracks = await getTracksByGenre(genre);

    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="color:#fc0; font-weight:bold;">${escapeHtml(genre)} (${tracks.length})</span>
        <div style="display:flex; gap:4px;">
          <button id="genre-play-all" style="padding:3px 8px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-size:10px; border-radius:3px;">Play All</button>
          <button id="genre-back" style="padding:3px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:3px;">Back</button>
        </div>
      </div>
      <div id="genre-track-list" style="max-height:55vh; overflow-y:auto;">
        ${tracks.map((t, i) => `
          <div class="genre-track" data-idx="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; border-bottom:1px solid #222; cursor:pointer;">
            <div style="flex:1; min-width:0;">
              <span style="color:#0f0;">${escapeHtml(t.title)}</span>
              <span style="color:#666;"> — ${escapeHtml(t.artist)}</span>
            </div>
            <div style="flex-shrink:0; display:flex; gap:4px; align-items:center;">
              <span style="color:#555; font-size:9px;">${sourceIcon(t.source)}</span>
              <span style="color:#555; font-size:10px;">${formatDuration(t.duration)}</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;

    content.querySelector("#genre-back")!.addEventListener("click", () => renderGenreList());

    content.querySelector("#genre-play-all")!.addEventListener("click", async () => {
      await playTracks(tracks);
      if (visible) toggleGenrePanel();
    });

    content.querySelectorAll(".genre-track").forEach((row) => {
      row.addEventListener("click", async () => {
        const idx = parseInt((row as HTMLElement).dataset.idx || "0");
        await playTracks([tracks[idx]]);
        if (visible) toggleGenrePanel();
      });
    });
  } catch (e) {
    content.innerHTML = `<div style="color:#f00;">Error: ${e}</div>`;
  }
}

function sourceIcon(source: string): string {
  switch (source) {
    case "youtube": return "▶";
    case "soundcloud": return "SC";
    default: return "♪";
  }
}

async function playTracks(tracks: PlaylistTrack[]) {
  if (!webampRef || tracks.length === 0) return;

  const webampTracks = await Promise.all(
    tracks.map(async (t) => {
      let url: string;
      if (t.source === "youtube") {
        try {
          const filePath = t.source_id.startsWith("/") || t.source_id.includes(":\\")
            ? t.source_id
            : await extractAudio(t.source_id);
          url = convertFileSrc(filePath);
        } catch {
          url = "";
        }
      } else if (t.source === "soundcloud") {
        try {
          const filePath = await extractAudioUrl(t.source_id);
          url = convertFileSrc(filePath);
        } catch {
          url = "";
        }
      } else {
        url = convertFileSrc(t.source_id);
      }
      return {
        metaData: { artist: t.artist || "Unknown", title: t.title },
        url,
        duration: t.duration,
      };
    }),
  );

  webampRef.setTracksToPlay(webampTracks.filter((t) => t.url));
}

// ─── YouTube Settings (cookies + playlist import) ───

export function initYouTubeSettings() {
  // Lazy — created on first toggle
}

let ytSettingsPanel: HTMLDivElement | null = null;
let ytSettingsVisible = false;

export function toggleYouTubeSettings() {
  if (!ytSettingsPanel) createYtSettingsPanel();
  ytSettingsVisible = !ytSettingsVisible;
  ytSettingsPanel!.style.display = ytSettingsVisible ? "flex" : "none";
  if (ytSettingsVisible) refreshYtStatus();
}

function createYtSettingsPanel() {
  ytSettingsPanel = document.createElement("div");
  ytSettingsPanel.id = "yt-settings-overlay";
  ytSettingsPanel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 460px; max-height: 80vh; background: #1a1a2e; border: 2px solid #444; border-radius: 8px;
    color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif; font-size: 11px;
    z-index: 10000; flex-direction: column;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;
  ytSettingsPanel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#f00;">YouTube Settings</span>
      <button id="yt-settings-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div style="padding: 12px; overflow-y: auto; max-height: calc(80vh - 40px);">
      <!-- Cookies auth -->
      <div style="border:1px solid #333; border-radius:4px; padding:10px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:bold; color:#f00;">Cookies (auth)</span>
          <span id="yt-cookies-status" style="font-size:10px; color:#888;"></span>
        </div>
        <div style="color:#888; font-size:10px; margin-bottom:8px;">
          Export cookies from your browser (Netscape format) to access private playlists and age-restricted content.
        </div>
        <div style="display:flex; gap:6px;">
          <button id="yt-cookies-browse" style="flex:1; padding:5px; background:#333; border:1px solid #555; color:#f00; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Browse cookies.txt</button>
          <button id="yt-cookies-clear" style="padding:5px 10px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Clear</button>
        </div>
        <div id="yt-cookies-msg" style="color:#888; margin-top:4px; font-size:10px;"></div>
      </div>

      <!-- Playlist import -->
      <div style="border:1px solid #333; border-radius:4px; padding:10px;">
        <div style="margin-bottom:8px;">
          <span style="font-weight:bold; color:#f00;">Import Playlist</span>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input id="yt-playlist-url" type="text" placeholder="YouTube playlist URL" style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#f00; font-family:inherit; font-size:11px; border-radius:3px;" />
          <button id="yt-playlist-import" style="padding:5px 10px; background:#333; border:1px solid #555; color:#f00; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Import</button>
        </div>
        <div id="yt-import-msg" style="color:#888; font-size:10px;"></div>
      </div>
    </div>
  `;

  document.body.appendChild(ytSettingsPanel);

  ytSettingsPanel.querySelector("#yt-settings-close")!.addEventListener("click", () => toggleYouTubeSettings());

  // Cookies browse
  ytSettingsPanel.querySelector("#yt-cookies-browse")!.addEventListener("click", async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Cookies", extensions: ["txt"] }],
    });
    if (selected) {
      const path = typeof selected === "string" ? selected : selected;
      try {
        await youtubeSetCookies(path as string);
        setYtMsg("yt-cookies-msg", `Saved: ${path}`, "#0f0");
        refreshYtStatus();
      } catch (e) {
        setYtMsg("yt-cookies-msg", `Error: ${e}`, "#f00");
      }
    }
  });

  // Cookies clear
  ytSettingsPanel.querySelector("#yt-cookies-clear")!.addEventListener("click", async () => {
    await youtubeClearCookies();
    setYtMsg("yt-cookies-msg", "Cookies cleared", "#888");
    refreshYtStatus();
  });

  // Playlist import
  ytSettingsPanel.querySelector("#yt-playlist-import")!.addEventListener("click", async () => {
    const input = ytSettingsPanel?.querySelector("#yt-playlist-url") as HTMLInputElement;
    const url = input?.value.trim();
    if (!url) return;
    setYtMsg("yt-import-msg", "Fetching playlist...", "#fc0");

    try {
      const tracks = await youtubeGetPlaylist(url);
      if (tracks.length === 0) {
        setYtMsg("yt-import-msg", "No tracks found in playlist", "#888");
        return;
      }

      // Import tracks into a new GOAMP playlist
      const { createPlaylist, addTrackToPlaylist } = await import("../lib/tauri-ipc");
      const name = `YouTube Import (${tracks.length})`;
      const playlist = await createPlaylist(name);

      for (const t of tracks) {
        await addTrackToPlaylist(playlist.id, {
          title: t.title,
          artist: t.channel,
          duration: t.duration,
          source: "youtube",
          source_id: t.id,
          genre: t.genre || "",
        });
      }

      setYtMsg("yt-import-msg", `Imported "${name}" — ${tracks.length} tracks`, "#0f0");
      input.value = "";
    } catch (e) {
      setYtMsg("yt-import-msg", `Error: ${e}`, "#f00");
    }
  });
}

function setYtMsg(id: string, text: string, color: string) {
  const el = ytSettingsPanel?.querySelector(`#${id}`);
  if (el) {
    (el as HTMLDivElement).textContent = text;
    (el as HTMLDivElement).style.color = color;
  }
}

async function refreshYtStatus() {
  try {
    const path = await youtubeGetCookies();
    const badge = ytSettingsPanel?.querySelector("#yt-cookies-status") as HTMLSpanElement;
    if (badge) {
      if (path) {
        badge.textContent = "Active";
        badge.style.color = "#0f0";
      } else {
        badge.textContent = "No cookies";
        badge.style.color = "#888";
      }
    }
  } catch {
    // ignore
  }
}
