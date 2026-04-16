import { describe, it, expect, beforeEach } from 'vitest'
import { PlaylistService } from './PlaylistService'
import { MockTransport } from './transport'
import type { Playlist, PlaylistTrack } from './interfaces'

const fakePlaylist: Playlist = { id: '1', name: 'Test', created_at: 0, updated_at: 0, track_count: 0 }
const fakeTrack: PlaylistTrack = {
  id: 't1', position: 0, title: 'Song', artist: 'Artist', duration: 180,
  source: 'local', source_id: '/a.mp3', album: '', original_title: '',
  original_artist: '', cover: '', genre: '',
}

describe('PlaylistService', () => {
  let transport: MockTransport
  let svc: PlaylistService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new PlaylistService(transport)
  })

  it('create calls create_playlist', async () => {
    transport.setResponse('create_playlist', fakePlaylist)
    const result = await svc.create('Test')
    expect(transport.lastCall).toEqual({ command: 'create_playlist', args: { name: 'Test' } })
    expect(result).toEqual(fakePlaylist)
  })

  it('list calls list_playlists', async () => {
    transport.setResponse('list_playlists', [fakePlaylist])
    const result = await svc.list()
    expect(transport.lastCall.command).toBe('list_playlists')
    expect(result).toHaveLength(1)
  })

  it('getTracks calls get_playlist_tracks', async () => {
    transport.setResponse('get_playlist_tracks', [fakeTrack])
    await svc.getTracks('1')
    expect(transport.lastCall).toEqual({ command: 'get_playlist_tracks', args: { playlistId: '1' } })
  })

  it('delete calls delete_playlist', async () => {
    transport.setResponse('delete_playlist', undefined)
    await svc.delete('1')
    expect(transport.lastCall).toEqual({ command: 'delete_playlist', args: { playlistId: '1' } })
  })

  it('saveSession calls save_session', async () => {
    transport.setResponse('save_session', undefined)
    await svc.saveSession([])
    expect(transport.lastCall.command).toBe('save_session')
  })
})
