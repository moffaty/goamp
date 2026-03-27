import { convertFileSrc } from "@tauri-apps/api/core";
import {
  listPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylistTracks,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  renameTrack,
  updateTrackSource,
  type PlaylistTrack,
  type TrackInput,
} from "../lib/tauri-ipc";
import { yandexGetTrackUrl, yandexDownloadToLibrary } from "../yandex/yandex-service";
import { track, trackError } from "../lib/analytics";
import { getSkinColors, escapeHtml, formatDuration } from "../lib/ui-utils";
import type Webamp from "webamp";

let panel: HTMLElement | null = null;
let webampRef: Webamp | null = null;
let currentPlaylistId: string | null = null;

export function initPlaylistPanel(webamp: Webamp) {
  webampRef = webamp;
}

export function togglePlaylistPanel() {
  if (panel) {
    closePanel();
  } else {
    openPanel();
  }
}

function sourceLabel(source: string): { icon: string; color: string } {
  switch (source) {
    case "yandex":
      return { icon: "Y", color: "#fc0" };
    case "youtube":
      return { icon: "▶", color: "#f00" };
    case "soundcloud":
      return { icon: "S", color: "#f50" };
    default:
      return { icon: "♪", color: "#888" };
  }
}

async function openPanel() {
  if (panel) return;
  const c = getSkinColors(webampRef);

  panel = document.createElement("div");
  panel.id = "playlist-panel-overlay";
  panel.innerHTML = `
    <div class="pl-container" style="background:${c.bg};border-color:${c.fg}">
      <div class="pl-header" style="border-color:${c.fg}">
        <span class="pl-title" style="color:${c.accent}">PLAYLISTS</span>
        <div class="pl-header-btns">
          <button id="pl-new-btn" style="color:${c.text};border-color:${c.fg}">+ New</button>
          <button id="pl-close-btn" style="color:${c.text}">\u00d7</button>
        </div>
      </div>
      <div class="pl-body">
        <div id="pl-list" class="pl-list" style="border-color:${c.fg}"></div>
        <div id="pl-tracks" class="pl-tracks"></div>
      </div>
      <div id="pl-status" class="pl-status" style="color:${c.text};border-color:${c.fg}">
        Select a playlist
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  injectStyles(c);

  document.getElementById("pl-close-btn")!.addEventListener("click", closePanel);
  document.getElementById("pl-new-btn")!.addEventListener("click", () => promptNewPlaylist(c));
  panel.addEventListener("click", (e) => {
    if (e.target === panel) closePanel();
  });
  document.addEventListener("keydown", panelKeyHandler);

  await renderPlaylists(c);

  // Restore last selected playlist
  const lastId = localStorage.getItem("goamp_last_playlist_id");
  if (lastId && !currentPlaylistId) {
    currentPlaylistId = lastId;
    await renderPlaylists(c);
    await renderTracks(lastId, c);
  }
}

function panelKeyHandler(e: KeyboardEvent) {
  if (e.key === "Escape") closePanel();
}

function closePanel() {
  if (panel) {
    panel.classList.add("pl-closing");
    document.removeEventListener("keydown", panelKeyHandler);
    setTimeout(() => {
      panel?.remove();
      panel = null;
      currentPlaylistId = null;
    }, 150);
  }
}

async function promptNewPlaylist(c: ReturnType<typeof getSkinColors>) {
  const name = prompt("Playlist name:");
  if (!name?.trim()) return;

  try {
    await createPlaylist(name.trim());
    track("playlist_created", { name: name.slice(0, 50) });
    await renderPlaylists(c);
  } catch (e) {
    trackError(e, { action: "create_playlist" });
  }
}

async function renderPlaylists(c: ReturnType<typeof getSkinColors>) {
  const container = document.getElementById("pl-list");
  if (!container) return;

  try {
    const playlists = await listPlaylists();
    container.innerHTML = "";

    if (playlists.length === 0) {
      container.innerHTML = `<div style="color:${c.fg};padding:8px;font-size:10px">No playlists yet. Click "+ New" to create one.</div>`;
      return;
    }

    for (const pl of playlists) {
      const row = document.createElement("div");
      row.className = `pl-row${currentPlaylistId === pl.id ? " pl-row-active" : ""}`;
      row.innerHTML = `
        <span class="pl-row-name" style="color:${currentPlaylistId === pl.id ? c.accent : c.text}">${escapeHtml(pl.name)}</span>
        <span class="pl-row-count" style="color:${c.fg}">${pl.track_count}</span>
        <button class="pl-row-del" style="color:${c.fg}" title="Delete">\u00d7</button>
      `;

      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("pl-row-del")) return;
        currentPlaylistId = pl.id;
        localStorage.setItem("goamp_last_playlist_id", pl.id);
        renderPlaylists(c);
        renderTracks(pl.id, c);
      });

      row.addEventListener("dblclick", async (e) => {
        if ((e.target as HTMLElement).classList.contains("pl-row-del")) return;
        const tracks = await getPlaylistTracks(pl.id);
        if (tracks.length > 0) {
          playPlaylist(tracks);
        }
      });

      row.querySelector(".pl-row-del")!.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${pl.name}"?`)) return;
        try {
          await deletePlaylist(pl.id);
          if (currentPlaylistId === pl.id) {
            currentPlaylistId = null;
            const tracks = document.getElementById("pl-tracks");
            if (tracks) tracks.innerHTML = "";
          }
          track("playlist_deleted");
          await renderPlaylists(c);
        } catch (err) {
          trackError(err, { action: "delete_playlist" });
        }
      });

      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:red;padding:8px">Error: ${e}</div>`;
  }
}

/** Get current tracks from Webamp Redux store */
function getWebampTracks(): { title: string; artist: string; duration: number; url: string }[] {
  if (!webampRef) return [];
  const store = (webampRef as any).store;
  if (!store) return [];
  const state = store.getState();
  const tracks = state?.playlist?.tracks || {};
  const order: string[] = state?.playlist?.trackOrder || [];
  return order
    .map((id: string) => tracks[id])
    .filter(Boolean)
    .map((t: any) => ({
      title: t.title || t.defaultName || "Unknown",
      artist: t.artist || "",
      duration: t.duration || 0,
      url: t.url || "",
    }));
}

function webampTrackToInput(t: { title: string; artist: string; duration: number; url: string }): TrackInput {
  const yaMatch = t.url.match(/#ya:(\d+)$/);
  const isYandex = !!yaMatch;
  const isYoutube = t.url.includes("audio_cache");
  return {
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    source: isYandex ? "yandex" : isYoutube ? "youtube" : "local",
    source_id: isYandex ? yaMatch![1] : t.url,
  };
}

async function renderTracks(playlistId: string, c: ReturnType<typeof getSkinColors>) {
  const container = document.getElementById("pl-tracks");
  const status = document.getElementById("pl-status");
  if (!container) return;

  try {
    const tracks = await getPlaylistTracks(playlistId);
    container.innerHTML = "";

    // Action bar: add tracks from current Webamp queue
    const actionBar = document.createElement("div");
    actionBar.className = "pl-action-bar";
    actionBar.style.borderColor = c.fg;

    const addCurrentBtn = document.createElement("div");
    addCurrentBtn.className = "pl-action-btn";
    addCurrentBtn.style.color = c.accent;
    addCurrentBtn.textContent = "\u2795 Add playing track";
    addCurrentBtn.addEventListener("click", async () => {
      const wTracks = getWebampTracks();
      const store = (webampRef as any)?.store;
      const currentIndex = store?.getState()?.playlist?.currentTrack;
      const order: string[] = store?.getState()?.playlist?.trackOrder || [];
      const currentId = currentIndex != null ? order[currentIndex] : null;
      const currentTrack = currentId ? wTracks.find((_, i) => i === currentIndex) : wTracks[0];
      if (!currentTrack) {
        if (status) status.textContent = "No track playing";
        return;
      }
      try {
        await addTrackToPlaylist(playlistId, webampTrackToInput(currentTrack));
        await renderTracks(playlistId, c);
        await renderPlaylists(c);
        if (status) status.textContent = `Added: ${currentTrack.title}`;
      } catch (e) {
        trackError(e, { action: "add_current_track" });
      }
    });
    actionBar.appendChild(addCurrentBtn);

    const addAllBtn = document.createElement("div");
    addAllBtn.className = "pl-action-btn";
    addAllBtn.style.color = c.accent;
    addAllBtn.textContent = "\u2795 Add all from queue";
    addAllBtn.addEventListener("click", async () => {
      const wTracks = getWebampTracks();
      if (wTracks.length === 0) {
        if (status) status.textContent = "Queue is empty";
        return;
      }
      try {
        for (const t of wTracks) {
          await addTrackToPlaylist(playlistId, webampTrackToInput(t));
        }
        await renderTracks(playlistId, c);
        await renderPlaylists(c);
        if (status) status.textContent = `Added ${wTracks.length} tracks`;
        track("playlist_add_all", { count: wTracks.length });
      } catch (e) {
        trackError(e, { action: "add_all_tracks" });
      }
    });
    actionBar.appendChild(addAllBtn);
    container.appendChild(actionBar);

    if (tracks.length === 0) {
      container.innerHTML += `<div style="color:${c.fg};padding:8px;font-size:10px">Empty playlist. Add tracks from queue or YouTube search (right-click).</div>`;
      if (status) status.textContent = "0 tracks";
      return;
    }

    const totalDuration = tracks.reduce((s, t) => s + t.duration, 0);
    if (status) status.textContent = `${tracks.length} tracks \u2022 ${formatDuration(totalDuration)}`;

    // Play all button
    const playAllBtn = document.createElement("div");
    playAllBtn.className = "pl-play-all";
    playAllBtn.style.color = c.accent;
    playAllBtn.textContent = "\u25b6 Play all";
    playAllBtn.addEventListener("click", () => playPlaylist(tracks));
    container.appendChild(playAllBtn);

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const sourceBadge = sourceLabel(t.source);
      const hasOriginal = t.original_title || t.original_artist;
      const originalInfo = hasOriginal
        ? `<span class="pl-track-original" style="color:${c.fg};font-size:9px;" title="Original: ${escapeHtml(t.original_artist || t.artist)} — ${escapeHtml(t.original_title || t.title)}"> (${escapeHtml(t.original_title || t.title)})</span>`
        : "";
      const albumInfo = t.album ? `<span class="pl-track-album" style="color:${c.fg};font-size:9px;"> [${escapeHtml(t.album)}]</span>` : "";

      const row = document.createElement("div");
      row.className = "pl-track-row";
      row.style.animationDelay = `${i * 20}ms`;
      const dlBtn = t.source === "yandex"
        ? `<button class="pl-track-dl" style="color:#88f" title="Download locally">↓</button>`
        : "";
      row.innerHTML = `
        <span class="pl-track-num" style="color:${c.fg}">${i + 1}</span>
        <span class="pl-source-badge" style="color:${sourceBadge.color};font-size:8px;width:14px;text-align:center;" title="${t.source}">${sourceBadge.icon}</span>
        <div class="pl-track-info">
          <span class="pl-track-title" style="color:${c.text}">${escapeHtml(t.title)}${originalInfo}${albumInfo}</span>
          <span class="pl-track-artist" style="color:${c.accent}">${escapeHtml(t.artist)}</span>
        </div>
        <span class="pl-track-dur" style="color:${c.fg}">${formatDuration(t.duration)}</span>
        ${dlBtn}
        <button class="pl-track-rename" style="color:${c.fg}" title="Rename">✎</button>
        <button class="pl-track-del" style="color:${c.fg}" title="Remove">\u00d7</button>
      `;

      row.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("pl-track-del") || target.classList.contains("pl-track-rename") || target.classList.contains("pl-track-dl")) return;
        playSingleTrack(t);
      });

      row.querySelector(".pl-track-rename")!.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newTitle = prompt("Track title:", t.title);
        if (newTitle === null) return;
        const newArtist = prompt("Artist:", t.artist);
        if (newArtist === null) return;
        try {
          await renameTrack(t.id, newTitle || undefined, newArtist || undefined);
          await renderTracks(playlistId, c);
        } catch (err) {
          trackError(err, { action: "rename_track" });
        }
      });

      const dlEl = row.querySelector(".pl-track-dl");
      if (dlEl) {
        dlEl.addEventListener("click", async (e) => {
          e.stopPropagation();
          const btn = dlEl as HTMLButtonElement;
          try {
            btn.textContent = "…";
            const filePath = await yandexDownloadToLibrary(t.source_id, t.title, t.artist);
            await updateTrackSource(t.id, "local", filePath);
            btn.textContent = "✓";
            btn.style.color = "#0f0";
            // Refresh after short delay so user sees the checkmark
            setTimeout(() => renderTracks(playlistId, c), 1000);
          } catch (err) {
            btn.textContent = "!";
            btn.style.color = "#f00";
            trackError(err, { action: "download_track" });
          }
        });
      }

      row.querySelector(".pl-track-del")!.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await removeTrackFromPlaylist(t.id);
          await renderTracks(playlistId, c);
          await renderPlaylists(c);
        } catch (err) {
          trackError(err, { action: "remove_track" });
        }
      });

      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:red;padding:8px">Error: ${e}</div>`;
  }
}

async function trackToWebamp(t: PlaylistTrack) {
  let url: string;
  if (t.source === "yandex") {
    try {
      const streamUrl = await yandexGetTrackUrl(t.source_id);
      url = `${streamUrl}#ya:${t.source_id}`;
    } catch {
      url = "";
    }
  } else {
    // source_id is saved as Tauri asset URL — use directly, don't double-wrap
    url = t.source_id.startsWith("http") ? t.source_id : convertFileSrc(t.source_id);
  }
  return {
    metaData: { artist: t.artist, title: t.title },
    url,
    duration: t.duration,
  };
}

async function playPlaylist(tracks: PlaylistTrack[]) {
  if (!webampRef || tracks.length === 0) return;
  const webampTracks = await Promise.all(tracks.map(trackToWebamp));
  const valid = webampTracks.filter((t) => t.url);
  if (valid.length === 0) return;
  webampRef.setTracksToPlay(valid);
  track("playlist_play", { track_count: valid.length });
  closePanel();
}

async function playSingleTrack(t: PlaylistTrack) {
  if (!webampRef) return;
  const wt = await trackToWebamp(t);
  if (!wt.url) return;
  webampRef.setTracksToPlay([wt]);
  closePanel();
}

/** Public: add a track to a specific playlist (called from SearchOverlay) */
export async function addTrackToPlaylistByName(
  playlistName: string,
  trackInput: TrackInput
): Promise<void> {
  let playlists = await listPlaylists();
  let target = playlists.find((p) => p.name === playlistName);

  if (!target) {
    target = await createPlaylist(playlistName);
  }

  await addTrackToPlaylist(target.id, trackInput);
}

function injectStyles(c: ReturnType<typeof getSkinColors>) {
  const existing = document.getElementById("pl-panel-styles");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "pl-panel-styles";
  style.textContent = `
    @keyframes pl-slide-in {
      from { opacity: 0; transform: translateY(-10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes pl-slide-out {
      from { opacity: 1; }
      to { opacity: 0; transform: scale(0.97); }
    }
    @keyframes pl-row-in {
      from { opacity: 0; transform: translateX(-6px); }
      to { opacity: 1; transform: translateX(0); }
    }

    #playlist-panel-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 30px;
      animation: pl-slide-in 0.2s ease-out;
    }
    #playlist-panel-overlay.pl-closing {
      animation: pl-slide-out 0.15s ease-in forwards;
    }

    .pl-container {
      width: 420px;
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
    .pl-container::after {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
      pointer-events: none;
    }

    .pl-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      border-bottom: 1px solid;
    }
    .pl-title {
      font-size: 11px;
      letter-spacing: 2px;
      font-weight: bold;
    }
    .pl-header-btns { display: flex; gap: 4px; align-items: center; }
    #pl-new-btn {
      background: none;
      border: 1px solid;
      padding: 2px 8px;
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
    }
    #pl-new-btn:hover { opacity: 0.7; }
    #pl-close-btn {
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      padding: 0 4px;
    }

    .pl-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 150px;
    }
    .pl-list {
      width: 140px;
      border-right: 1px solid;
      overflow-y: auto;
      flex-shrink: 0;
      scrollbar-width: thin;
      scrollbar-color: ${c.fg} ${c.textBg};
    }
    .pl-tracks {
      flex: 1;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: ${c.fg} ${c.textBg};
    }

    .pl-row {
      display: flex;
      align-items: center;
      padding: 4px 6px;
      cursor: pointer;
      gap: 4px;
      transition: background 0.1s;
    }
    .pl-row:hover { background: rgba(255,255,255,0.06); }
    .pl-row-active { background: rgba(255,255,255,0.1); }
    .pl-row-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pl-row-count { font-size: 9px; }
    .pl-row-del {
      background: none; border: none;
      font-size: 14px; cursor: pointer;
      opacity: 0; transition: opacity 0.1s;
      padding: 0 2px;
    }
    .pl-row:hover .pl-row-del { opacity: 1; }

    .pl-play-all {
      padding: 6px 8px;
      cursor: pointer;
      font-size: 11px;
      letter-spacing: 0.5px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .pl-play-all:hover { background: rgba(255,255,255,0.06); }

    .pl-track-row {
      display: flex;
      align-items: center;
      padding: 3px 6px;
      cursor: pointer;
      gap: 6px;
      animation: pl-row-in 0.15s ease-out both;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .pl-track-row:hover { background: rgba(255,255,255,0.06); }
    .pl-track-num { font-size: 9px; width: 16px; text-align: right; }
    .pl-track-info { flex: 1; overflow: hidden; min-width: 0; }
    .pl-track-title {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 11px;
    }
    .pl-track-artist {
      display: block;
      font-size: 9px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pl-track-dur { font-size: 10px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .pl-track-rename, .pl-track-del, .pl-track-dl {
      background: none; border: none;
      font-size: 13px; cursor: pointer;
      opacity: 0; transition: opacity 0.1s;
      padding: 0 2px;
    }
    .pl-track-row:hover .pl-track-rename,
    .pl-track-row:hover .pl-track-del,
    .pl-track-row:hover .pl-track-dl { opacity: 1; }
    .pl-source-badge {
      flex-shrink: 0;
      font-weight: bold;
    }

    .pl-action-bar {
      display: flex;
      gap: 2px;
      padding: 4px 6px;
      border-bottom: 1px solid;
    }
    .pl-action-btn {
      padding: 3px 8px;
      cursor: pointer;
      font-size: 10px;
      letter-spacing: 0.3px;
      white-space: nowrap;
    }
    .pl-action-btn:hover { background: rgba(255,255,255,0.08); }

    .pl-status {
      padding: 5px 8px;
      font-size: 10px;
      border-top: 1px solid;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
  `;
  document.head.appendChild(style);
}
