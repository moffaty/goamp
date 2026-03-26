import { invoke } from "@tauri-apps/api/core";

export interface LastfmSession {
  name: string;
  key: string;
}

export async function lastfmSaveSettings(
  apiKey: string,
  secret: string,
): Promise<void> {
  return invoke("lastfm_save_settings", { apiKey, secret });
}

export async function lastfmGetAuthUrl(): Promise<string> {
  return invoke("lastfm_get_auth_url");
}

export async function lastfmAuth(token: string): Promise<LastfmSession> {
  return invoke("lastfm_auth", { token });
}

export async function lastfmNowPlaying(
  artist: string,
  title: string,
  duration?: number,
): Promise<void> {
  return invoke("lastfm_now_playing", {
    artist,
    title,
    duration: duration ?? null,
  });
}

export async function lastfmScrobble(
  artist: string,
  title: string,
  timestamp: number,
): Promise<void> {
  return invoke("lastfm_scrobble", { artist, title, timestamp });
}

export async function lastfmGetStatus(): Promise<string | null> {
  return invoke("lastfm_get_status");
}
