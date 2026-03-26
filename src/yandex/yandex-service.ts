import { invoke } from "@tauri-apps/api/core";

export interface YandexTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover: string;
  available: boolean;
}

export interface YandexStation {
  id: string;
  name: string;
  icon: string;
}

export interface YandexPlaylist {
  kind: number;
  title: string;
  track_count: number;
  cover: string;
  owner: string;
}

export interface YandexAccount {
  uid: string;
  login: string;
  display_name: string;
  has_plus: boolean;
}

export async function yandexSaveToken(token: string): Promise<void> {
  return invoke("yandex_save_token", { token });
}

export async function yandexGetStatus(): Promise<YandexAccount | null> {
  return invoke("yandex_get_status");
}

export async function yandexOauthLogin(): Promise<void> {
  return invoke("yandex_oauth_login");
}

export async function yandexLogout(): Promise<void> {
  return invoke("yandex_logout");
}

export async function yandexSearch(
  query: string,
  page?: number,
): Promise<YandexTrack[]> {
  return invoke("yandex_search", { query, page: page ?? null });
}

export async function yandexGetTrackUrl(trackId: string): Promise<string> {
  return invoke("yandex_get_track_url", { trackId });
}

export async function yandexListStations(): Promise<YandexStation[]> {
  return invoke("yandex_list_stations");
}

export async function yandexStationTracks(
  stationId: string,
  lastTrackId?: string,
): Promise<YandexTrack[]> {
  return invoke("yandex_station_tracks", {
    stationId,
    lastTrackId: lastTrackId ?? null,
  });
}

export async function yandexListPlaylists(): Promise<YandexPlaylist[]> {
  return invoke("yandex_list_playlists");
}

export async function yandexGetPlaylistTracks(
  owner: string,
  kind: number,
): Promise<YandexTrack[]> {
  return invoke("yandex_get_playlist_tracks", { owner, kind });
}

export async function yandexImportPlaylist(
  owner: string,
  kind: number,
  name: string,
): Promise<string> {
  return invoke("yandex_import_playlist", { owner, kind, name });
}

export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
