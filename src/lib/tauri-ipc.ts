import { invoke } from "@tauri-apps/api/core";

export interface TrackMeta {
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
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
