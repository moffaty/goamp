import { invoke } from "@tauri-apps/api/core";

export interface LastfmSession {
  name: string;
  key: string;
}

export interface ScrobbleStatus {
  lastfm: boolean;
  listenbrainz: boolean;
  queue_count: number;
}

// ─── Last.fm ───

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
  duration?: number,
): Promise<void> {
  return invoke("lastfm_scrobble", {
    artist,
    title,
    timestamp,
    duration: duration ?? null,
  });
}

export async function lastfmGetStatus(): Promise<string | null> {
  return invoke("lastfm_get_status");
}

// ─── ListenBrainz ───

export async function listenbrainzSaveToken(
  token: string,
): Promise<string> {
  return invoke("listenbrainz_save_token", { token });
}

export async function listenbrainzGetStatus(): Promise<string | null> {
  return invoke("listenbrainz_get_status");
}

export async function listenbrainzLogout(): Promise<void> {
  return invoke("listenbrainz_logout");
}

export async function listenbrainzNowPlaying(
  artist: string,
  title: string,
): Promise<void> {
  return invoke("listenbrainz_now_playing", { artist, title });
}

export async function listenbrainzScrobble(
  artist: string,
  title: string,
  timestamp: number,
  duration?: number,
): Promise<void> {
  return invoke("listenbrainz_scrobble", {
    artist,
    title,
    timestamp,
    duration: duration ?? null,
  });
}

// ─── Queue ───

export async function scrobbleGetStatus(): Promise<ScrobbleStatus> {
  return invoke("scrobble_get_status");
}

export async function scrobbleFlushQueue(): Promise<number> {
  return invoke("scrobble_flush_queue");
}
