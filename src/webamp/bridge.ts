import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { scanDirectory, saveSession, loadSession, getPlaylistTracks } from "../lib/tauri-ipc";
import { toWebampTracks } from "./tracks";
import { track, trackError } from "../lib/analytics";
import { initSearchOverlay, toggleSearchOverlay } from "../youtube/SearchOverlay";
import { initPlaylistPanel, togglePlaylistPanel } from "../playlists/PlaylistPanel";
import type Webamp from "webamp";

export function setupBridge(webamp: Webamp) {
  setupKeyboard(webamp);
  setupTrackTracking(webamp);
  setupClose(webamp);
  setupSessionRestore(webamp);
  initSearchOverlay(webamp);
  initPlaylistPanel(webamp);
}

function setupClose(webamp: Webamp) {
  const appWindow = getCurrentWindow();

  const handleClose = async () => {
    try {
      await saveCurrentSession(webamp);
    } catch (e) {
      console.error("[GOAMP] Failed to save session:", e);
    }
    appWindow.destroy();
  };

  webamp.onWillClose(() => {
    handleClose();
  });

  webamp.onClose(() => {
    handleClose();
  });
}

async function saveCurrentSession(webamp: Webamp) {
  const store = (webamp as any).store;
  if (!store) return;

  const state = store.getState();
  const tracks = state?.playlist?.tracks || {};
  const order: string[] = state?.playlist?.trackOrder || [];

  const trackInputs = order
    .map((id: string) => tracks[id])
    .filter(Boolean)
    .map((t: any) => {
      const url: string = t.url || "";
      const isYoutube = url.includes("audio_cache");
      return {
        title: t.title || t.defaultName || "Unknown",
        artist: t.artist || "",
        duration: t.duration || 0,
        source: isYoutube ? "youtube" : "local",
        source_id: url,
      };
    });

  if (trackInputs.length > 0) {
    await saveSession(trackInputs);
    console.log("[GOAMP] Session saved:", trackInputs.length, "tracks");
  }
}

async function setupSessionRestore(webamp: Webamp) {
  try {
    // Try last selected playlist first
    const lastPlaylistId = localStorage.getItem("goamp_last_playlist_id");
    if (lastPlaylistId) {
      const tracks = await getPlaylistTracks(lastPlaylistId);
      if (tracks.length > 0) {
        const webampTracks = tracks.map((t) => ({
          metaData: {
            artist: t.artist || "Unknown Artist",
            title: t.title || "Unknown Track",
          },
          url: convertFileSrc(t.source_id),
          duration: t.duration,
        }));
        webamp.setTracksToPlay(webampTracks);
        console.log("[GOAMP] Playlist restored:", tracks.length, "tracks");
        return;
      }
    }

    // Fallback to last session
    const tracks = await loadSession();
    if (tracks.length === 0) return;

    const webampTracks = tracks.map((t) => ({
      metaData: {
        artist: t.artist || "Unknown Artist",
        title: t.title || "Unknown Track",
      },
      url: t.source === "youtube" ? convertFileSrc(t.source_id) : t.source_id,
      duration: t.duration,
    }));

    webamp.setTracksToPlay(webampTracks);
    console.log("[GOAMP] Session restored:", tracks.length, "tracks");
  } catch (e) {
    console.error("[GOAMP] Failed to restore session:", e);
  }
}

function setupTrackTracking(webamp: Webamp) {
  webamp.onTrackDidChange((trackInfo) => {
    if (!trackInfo) return;

    const url = trackInfo.url || "";
    const source = url.startsWith("http") ? "youtube" : "local";
    const ext = url.split(".").pop()?.toLowerCase() || "unknown";

    track("track_played", {
      source,
      format: source === "local" ? ext : "stream",
    });

    // Track with artist/title for future charts
    const meta = (trackInfo as any).metaData;
    if (meta?.artist || meta?.title) {
      track("track_info", {
        artist: (meta.artist || "Unknown").slice(0, 100),
        title: (meta.title || "Unknown").slice(0, 100),
        source,
      });
    }
  });
}

function setupKeyboard(webamp: Webamp) {
  document.addEventListener("keydown", async (e) => {
    // Ctrl+O — open folder (works on any keyboard layout via physical key code)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyO") {
      e.preventDefault();
      await openFolder(webamp);
    }
    // Ctrl+Shift+O — open files
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyO") {
      e.preventDefault();
      await openFiles(webamp);
    }
    // Ctrl+Y — YouTube search
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyY") {
      e.preventDefault();
      toggleSearchOverlay();
    }
    // L — toggle preset overlay (only when not typing in an input)
    const active = document.activeElement;
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyL" && !isTyping) {
      const store = (webamp as any).store;
      if (store) {
        const state = store.getState();
        const presets = state?.milkdrop?.presets || [];
        console.log("[GOAMP] Milkdrop presets loaded:", presets.length);
        console.log("[GOAMP] Milkdrop state:", {
          presets: presets.length,
          currentPresetIndex: state?.milkdrop?.currentPresetIndex,
          butterchurn: !!state?.milkdrop?.butterchurn,
          presetOverlayOpen: state?.milkdrop?.presetOverlayOpen,
        });
        store.dispatch({ type: "TOGGLE_PRESET_OVERLAY" });
      }
    }
    // Ctrl+P — playlist panel
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyP") {
      e.preventDefault();
      togglePlaylistPanel();
    }
    // Ctrl+S — load skin
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyS") {
      e.preventDefault();
      await loadSkin(webamp);
    }
  });
}

export async function openFolder(webamp: Webamp): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select music folder",
  });

  if (!selected) return;

  const path = typeof selected === "string" ? selected : selected[0];
  if (!path) return;

  try {
    const tracks = await scanDirectory(path);
    if (tracks.length === 0) return;

    const webampTracks = toWebampTracks(tracks);
    webamp.setTracksToPlay(webampTracks);
    track("folder_opened", { track_count: tracks.length });
  } catch (e) {
    trackError(e, { action: "open_folder" });
  }
}

export async function loadSkin(webamp: Webamp): Promise<void> {
  const selected = await open({
    multiple: false,
    title: "Select Winamp skin (.wsz)",
    filters: [
      {
        name: "Winamp Skin",
        extensions: ["wsz", "zip"],
      },
    ],
  });

  if (!selected) return;

  const path = typeof selected === "string" ? selected : selected[0];
  if (!path) return;

  try {
    const skinUrl = convertFileSrc(path);
    webamp.setSkinFromUrl(skinUrl);
    track("skin_loaded");
  } catch (e) {
    trackError(e, { action: "load_skin" });
  }
}

export async function openFiles(webamp: Webamp): Promise<void> {
  const selected = await open({
    multiple: true,
    title: "Select audio files",
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "flac", "ogg", "wav", "opus", "m4a", "aac"],
      },
    ],
  });

  if (!selected) return;

  const paths = Array.isArray(selected) ? selected : [selected];
  if (paths.length === 0) return;

  try {
    const { readMetadata } = await import("../lib/tauri-ipc");
    const metas = await Promise.all(paths.map((p) => readMetadata(p)));
    const webampTracks = toWebampTracks(metas);
    webamp.setTracksToPlay(webampTracks);
    track("files_opened", { track_count: metas.length });
  } catch (e) {
    trackError(e, { action: "open_files" });
  }
}
