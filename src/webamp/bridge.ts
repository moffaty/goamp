import { open } from "@tauri-apps/plugin-dialog";
import { scanDirectory } from "../lib/tauri-ipc";
import { toWebampTracks } from "./tracks";
import type Webamp from "webamp";

export function setupBridge(webamp: Webamp) {
  setupKeyboard(webamp);
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
  webamp.setTracksToPlay(webampTracks);
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
  webamp.setTracksToPlay(webampTracks);
}
