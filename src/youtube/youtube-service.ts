import { invoke } from "@tauri-apps/api/core";

export type SearchSource = "youtube" | "soundcloud" | "yandex";

export interface YoutubeResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  source: string;
  webpage_url: string;
}

export async function searchYoutube(
  query: string,
  limit?: number,
  source?: SearchSource,
): Promise<YoutubeResult[]> {
  return invoke("search_youtube", {
    query,
    limit: limit ?? null,
    source: source ?? null,
  });
}

export async function extractAudio(videoId: string): Promise<string> {
  return invoke("extract_audio", { videoId });
}

export async function extractAudioUrl(url: string): Promise<string> {
  return invoke("extract_audio_url", { url });
}
