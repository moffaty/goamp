import { invoke } from "@tauri-apps/api/core";

export type SearchSource = "youtube" | "soundcloud";

export interface YoutubeResult {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  source: string;
  webpage_url: string;
  genre: string;
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

// Note: `extract_audio_stream_url` (Rust) is still registered — it is called
// internally by the `goampaudio://` protocol handler. No frontend wrapper is
// needed: the webview's <audio> element loads the protocol URL directly.
