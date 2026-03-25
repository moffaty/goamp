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
  return {
    metaData: {
      artist: meta.artist || "Unknown Artist",
      title: meta.title || "Unknown Track",
    },
    url: convertFileSrc(meta.path),
    duration: meta.duration,
  };
}

export function toWebampTracks(metas: TrackMeta[]): WebampTrack[] {
  return metas.map(toWebampTrack);
}
