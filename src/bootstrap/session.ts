// src/bootstrap/session.ts
import { convertFileSrc } from '@tauri-apps/api/core'
import type { PlayerStore } from '../player/PlayerStore'
import type { IPlaylistService, TrackInput } from '../services/interfaces'

async function resolvePlaylistTracks(
  tracks: { source: string; source_id: string; artist: string; title: string; duration: number }[],
) {
  return tracks
    .map((t) => ({
      metaData: { artist: t.artist || 'Unknown Artist', title: t.title || 'Unknown Track' },
      url: t.source_id.startsWith('http') ? t.source_id : convertFileSrc(t.source_id),
      duration: t.duration,
    }))
    .filter((t) => t.url)
}

export async function saveSession(store: PlayerStore, playlists: IPlaylistService): Promise<void> {
  const tracks = store.getTracks()
  if (tracks.length === 0) return

  const inputs: TrackInput[] = tracks.map((t) => {
    const isYoutube = (t.url || '').includes('audio_cache')
    return {
      title: t.title || t.defaultName || 'Unknown',
      artist: t.artist || '',
      duration: t.duration || 0,
      source: isYoutube ? 'youtube' : 'local',
      source_id: t.url || '',
    }
  })
  await playlists.saveSession(inputs)
}

export async function restoreSession(
  setTracksToPlay: (tracks: any[]) => void,
  dispatchStop: () => void,
  playlists: IPlaylistService,
): Promise<void> {
  const lastPlaylistId = localStorage.getItem('goamp_last_playlist_id')
  if (lastPlaylistId) {
    const tracks = await playlists.getTracks(lastPlaylistId)
    if (tracks.length > 0) {
      const valid = await resolvePlaylistTracks(tracks)
      if (valid.length > 0) {
        setTracksToPlay(valid)
        dispatchStop()
        return
      }
    }
  }

  const tracks = await playlists.loadSession()
  if (tracks.length === 0) return
  const valid = await resolvePlaylistTracks(tracks)
  if (valid.length === 0) return
  setTracksToPlay(valid)
  dispatchStop()
}
