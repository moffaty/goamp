import { invoke } from "@tauri-apps/api/core";

export interface TrackMeta {
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  duration: number;
}

export async function scanDirectory(path: string): Promise<TrackMeta[]> {
  return invoke("scan_directory", { path });
}

export async function readMetadata(path: string): Promise<TrackMeta> {
  return invoke("read_metadata", { path });
}

// Playlists
export interface Playlist {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  track_count: number;
}

export interface PlaylistTrack {
  id: string;
  position: number;
  title: string;
  artist: string;
  duration: number;
  source: string;
  source_id: string;
  album: string;
  original_title: string;
  original_artist: string;
  cover: string;
  genre: string;
}

export interface TrackInput {
  title: string;
  artist: string;
  duration: number;
  source: string;
  source_id: string;
  album?: string;
  original_title?: string;
  original_artist?: string;
  cover?: string;
  genre?: string;
}

export async function createPlaylist(name: string): Promise<Playlist> {
  return invoke("create_playlist", { name });
}

export async function listPlaylists(): Promise<Playlist[]> {
  return invoke("list_playlists");
}

export async function getPlaylistTracks(
  playlistId: string
): Promise<PlaylistTrack[]> {
  return invoke("get_playlist_tracks", { playlistId });
}

export async function addTrackToPlaylist(
  playlistId: string,
  track: TrackInput
): Promise<PlaylistTrack> {
  return invoke("add_track_to_playlist", { playlistId, track });
}

export async function removeTrackFromPlaylist(
  trackId: string
): Promise<void> {
  return invoke("remove_track_from_playlist", { trackId });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  return invoke("delete_playlist", { playlistId });
}

export async function saveSession(tracks: TrackInput[]): Promise<void> {
  return invoke("save_session", { tracks });
}

export async function loadSession(): Promise<PlaylistTrack[]> {
  return invoke("load_session");
}

export async function renameTrack(
  trackId: string,
  title?: string,
  artist?: string,
): Promise<void> {
  return invoke("rename_track", { trackId, title: title ?? null, artist: artist ?? null });
}

export async function updateTrackSource(
  trackId: string,
  source: string,
  sourceId: string,
): Promise<void> {
  return invoke("update_track_source", { trackId, source, sourceId });
}

// Genre
export async function listGenres(): Promise<string[]> {
  return invoke("list_genres");
}

export async function getTracksByGenre(genre: string): Promise<PlaylistTrack[]> {
  return invoke("get_tracks_by_genre", { genre });
}

// YouTube auth
export async function youtubeSetCookies(path: string): Promise<void> {
  return invoke("youtube_set_cookies", { path });
}

export async function youtubeGetCookies(): Promise<string | null> {
  return invoke("youtube_get_cookies");
}

export async function youtubeClearCookies(): Promise<void> {
  return invoke("youtube_clear_cookies");
}

// YouTube playlists
export async function youtubeGetPlaylist(url: string): Promise<any[]> {
  return invoke("youtube_get_playlist", { url });
}

// ─── Radio ───

export interface RadioStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  language: string;
  codec: string;
  bitrate: number;
  votes: number;
  clickcount: number;
}

export interface RadioTag {
  name: string;
  stationcount: number;
}

export interface RadioNowPlaying {
  title: string;
  station_name: string;
  station_uuid: string;
}

export interface CachedSegment {
  index: number;
  title: string;
  duration_secs: number;
}

export async function radioSearch(
  query: string,
  tag?: string,
  country?: string,
  limit?: number,
): Promise<RadioStation[]> {
  return invoke("radio_search", { query, tag: tag ?? null, country: country ?? null, limit: limit ?? null });
}

export async function radioTopStations(limit?: number): Promise<RadioStation[]> {
  return invoke("radio_top_stations", { limit: limit ?? null });
}

export async function radioByTag(tag: string, limit?: number): Promise<RadioStation[]> {
  return invoke("radio_by_tag", { tag, limit: limit ?? null });
}

export async function radioTags(): Promise<RadioTag[]> {
  return invoke("radio_tags");
}

export async function radioAddFavorite(station: RadioStation): Promise<void> {
  return invoke("radio_add_favorite", { stationJson: JSON.stringify(station) });
}

export async function radioRemoveFavorite(stationuuid: string): Promise<void> {
  return invoke("radio_remove_favorite", { stationuuid });
}

export async function radioListFavorites(): Promise<RadioStation[]> {
  return invoke("radio_list_favorites");
}

export async function radioAddCustom(name: string, url: string, tags?: string): Promise<void> {
  return invoke("radio_add_custom", { name, url, tags: tags ?? null });
}

export async function radioRemoveCustom(id: string): Promise<void> {
  return invoke("radio_remove_custom", { id });
}

export async function radioListCustom(): Promise<RadioStation[]> {
  return invoke("radio_list_custom");
}

export async function radioPlay(station: RadioStation): Promise<string> {
  return invoke("radio_play", { stationJson: JSON.stringify(station) });
}

export async function radioStop(): Promise<void> {
  return invoke("radio_stop");
}

export async function radioNowPlaying(): Promise<RadioNowPlaying | null> {
  return invoke("radio_now_playing");
}

export async function radioListCached(): Promise<CachedSegment[]> {
  return invoke("radio_list_cached");
}

export async function radioSaveSegment(index: number, title?: string): Promise<string> {
  return invoke("radio_save_segment", { index, title: title ?? null });
}

export async function radioSaveLastSecs(secs: number, title?: string): Promise<string> {
  return invoke("radio_save_last_secs", { secs, title: title ?? null });
}
