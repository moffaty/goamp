import { invoke } from "@tauri-apps/api/core";

export interface YoutubeResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
}

export async function searchYoutube(query: string, limit?: number): Promise<YoutubeResult[]> {
  return invoke("search_youtube", { query, limit: limit ?? null });
}

export async function extractAudio(videoId: string): Promise<string> {
  return invoke("extract_audio", { videoId });
}

export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
