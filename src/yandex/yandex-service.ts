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

export interface DeviceCodeResponse {
  user_code: string;
  verification_url: string;
  interval: number;
  device_code: string;
  expires_in: number;
}

export async function yandexRequestDeviceCode(): Promise<DeviceCodeResponse> {
  return invoke("yandex_request_device_code");
}

export async function yandexPollToken(deviceCode: string): Promise<string> {
  return invoke("yandex_poll_token", { deviceCode });
}

export async function yandexRefreshToken(): Promise<void> {
  return invoke("yandex_refresh_token");
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

export async function yandexDownloadTrack(
  trackId: string,
  title: string,
  artist: string,
): Promise<string> {
  return invoke("yandex_download_track", { trackId, title, artist });
}

export async function yandexDownloadPlaylist(
  owner: string,
  kind: number,
): Promise<string[]> {
  return invoke("yandex_download_playlist", { owner, kind });
}

export async function yandexGetLikedTracks(): Promise<YandexTrack[]> {
  return invoke("yandex_get_liked_tracks");
}

export async function yandexGetTrackUrls(trackIds: string[]): Promise<string[]> {
  return invoke("yandex_get_track_urls", { trackIds });
}

export async function yandexOpenOAuthWindow(): Promise<void> {
  return invoke("yandex_open_oauth_window");
}

export async function yandexLikeTrack(trackId: string, like: boolean): Promise<void> {
  return invoke("yandex_like_track", { trackId, like });
}

export async function yandexDownloadToLibrary(
  trackId: string,
  title: string,
  artist: string,
): Promise<string> {
  return invoke("yandex_download_to_library", { trackId, title, artist });
}
