import { open } from "@tauri-apps/plugin-dialog";
import { scanDirectory } from "../lib/tauri-ipc";
import { toWebampTracks, type WebampTrack } from "./tracks";
import type Webamp from "webamp";

export function setupBridge(webamp: Webamp) {
  setupFilePicker(webamp);
  setupDragDrop(webamp);
}

function setupFilePicker(webamp: Webamp) {
  document.addEventListener("keydown", async (e) => {
    // Ctrl+O / Cmd+O — open folder
    if ((e.ctrlKey || e.metaKey) && e.key === "o") {
      e.preventDefault();
      await openFolder(webamp);
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

  const tracks = await scanDirectory(path);
  if (tracks.length === 0) return;

  const webampTracks = toWebampTracks(tracks);
  loadTracks(webamp, webampTracks);
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

  const { readMetadata } = await import("../lib/tauri-ipc");
  const metas = await Promise.all(paths.map((p) => readMetadata(p)));
  const webampTracks = toWebampTracks(metas);
  loadTracks(webamp, webampTracks);
}

function loadTracks(webamp: Webamp, tracks: WebampTrack[]) {
  webamp.setTracksToPlay(tracks);
}

function setupDragDrop(_webamp: Webamp) {
  // Webamp handles drag-drop of files natively onto its playlist window.
  // Custom drag-drop for folders can be added later.
}
