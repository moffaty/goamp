import { convertFileSrc } from "@tauri-apps/api/core";
import type { TrackMeta } from "../lib/tauri-ipc";

export interface WebampTrack {
  metaData: {
    artist: string;
    title: string;
  };
  url: string;
  duration: number;
}

export function toWebampTrack(meta: TrackMeta): WebampTrack {
  const url = convertFileSrc(meta.path);
  console.log(`[GOAMP] Track: ${meta.path} -> ${url}`);
  return {
    metaData: {
      artist: meta.artist || "Unknown Artist",
      title: meta.title || "Unknown Track",
    },
    url,
    duration: meta.duration,
  };
}

export function toWebampTracks(metas: TrackMeta[]): WebampTrack[] {
  return metas.map(toWebampTrack);
}
