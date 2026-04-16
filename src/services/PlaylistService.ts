import type { ITransport } from './transport'
import type { IPlaylistService, Playlist, PlaylistTrack, TrackInput } from './interfaces'

export class PlaylistService implements IPlaylistService {
  constructor(private t: ITransport) {}

  create(name: string) { return this.t.call<Playlist>('create_playlist', { name }) }
  list() { return this.t.call<Playlist[]>('list_playlists') }
  getTracks(playlistId: string) { return this.t.call<PlaylistTrack[]>('get_playlist_tracks', { playlistId }) }
  addTrack(playlistId: string, track: TrackInput) { return this.t.call<PlaylistTrack>('add_track_to_playlist', { playlistId, track }) }
  removeTrack(trackId: string) { return this.t.call<void>('remove_track_from_playlist', { trackId }) }
  delete(playlistId: string) { return this.t.call<void>('delete_playlist', { playlistId }) }
  saveSession(tracks: TrackInput[]) { return this.t.call<void>('save_session', { tracks }) }
  loadSession() { return this.t.call<PlaylistTrack[]>('load_session') }
  renameTrack(trackId: string, title?: string, artist?: string) {
    return this.t.call<void>('rename_track', { trackId, title: title ?? null, artist: artist ?? null })
  }
  updateTrackSource(trackId: string, source: string, sourceId: string) {
    return this.t.call<void>('update_track_source', { trackId, source, sourceId })
  }
  listGenres() { return this.t.call<string[]>('list_genres') }
  getTracksByGenre(genre: string) { return this.t.call<PlaylistTrack[]>('get_tracks_by_genre', { genre }) }
}
