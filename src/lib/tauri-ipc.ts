import { invoke } from "@tauri-apps/api/core";

export interface TrackMeta {
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number;
}

export async function scanDirectory(path: string): Promise<TrackMeta[]> {
  return invoke("scan_directory", { path });
}

export async function readMetadata(path: string): Promise<TrackMeta> {
  return invoke("read_metadata", { path });
}
