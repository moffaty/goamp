import type { Track } from './types'
import type { ModuleContext } from './ModuleContext'

export interface Playlist {
  id: string
  name: string
  trackCount: number
}

export interface SearchResult {
  track: Track
  previewUrl?: string
}

export interface ILibrary {
  getPlaylists(): Promise<Playlist[]>
  getPlaylistTracks(id: string): Promise<Track[]>
  getLikedTracks(): Promise<Track[]>
}

export interface ISource {
  readonly id: string
  readonly name: string

  init(ctx: ModuleContext): Promise<void>
  destroy(): void

  // Returns resolved streamUrl, or null if source controls playback itself (DRM)
  resolve(track: Track): Promise<string | null>

  search?(query: string): Promise<SearchResult[]>
  library?: ILibrary
}
