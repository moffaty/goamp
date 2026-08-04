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

/** Import a whole album/set/playlist by URL (SoundCloud set, YouTube playlist, …). */
export async function importPlaylist(url: string): Promise<YoutubeResult[]> {
  return invoke("import_playlist", { url });
}

/** Download a track to the OS Downloads folder as `Artist - Title.ext`; returns the path. */
export async function downloadTrack(item: YoutubeResult): Promise<string> {
  const url = item.source === "youtube" ? item.id : item.webpage_url || item.id;
  return invoke("download_track", { url, title: item.title, artist: item.channel });
}

/** True if the string looks like a playlist/album/set URL we can import. */
export function isPlaylistUrl(s: string): boolean {
  const t = s.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  return /\/sets\//i.test(t) || /[?&]list=/i.test(t) || /\/playlist/i.test(t);
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
