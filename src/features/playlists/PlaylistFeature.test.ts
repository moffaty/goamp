import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlaylistFeature } from './PlaylistFeature'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import { EVENTS } from '../../core/events'
import type { ModuleContext } from '../../core/ModuleContext'

function makeCtx(overrides: Partial<ModuleContext> = {}): ModuleContext {
  return {
    player: {
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
      next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
      loadTracks: vi.fn(),
      getState: vi.fn(() => ({ status: 'STOPPED' as const, track: null, timeElapsed: 0, duration: 0 })),
    },
    events: new EventBus(),
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn(), togglePanel: vi.fn() },
    storage: new LocalKVStorage('test-playlists'),
    transport: new MockTransport(),
    ...overrides,
  }
}

describe('PlaylistFeature', () => {
  let transport: MockTransport
  let feature: PlaylistFeature

  beforeEach(() => {
    transport = new MockTransport()
    feature = new PlaylistFeature(transport)
  })

  it('has id "playlists"', () => {
    expect(feature.id).toBe('playlists')
  })

  it('restores session from loadSession on init', async () => {
    transport.setResponse('load_session', [
      { id: '1', title: 'Song', artist: 'Artist', duration: 180, source: 'local', source_id: '/a.mp3',
        position: 0, album: '', original_title: '', original_artist: '', cover: '', genre: '' },
    ])
    transport.setResponse('feature_flags_list', [])
    const ctx = makeCtx()
    await feature.init(ctx)
    expect(ctx.player.loadTracks).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ title: 'Song', artist: 'Artist' }),
    ]))
  })

  it('restores from last_playlist_id if stored', async () => {
    transport.setResponse('get_playlist_tracks', [
      { id: '1', title: 'Playlist Song', artist: 'PA', duration: 200, source: 'local', source_id: '/b.mp3',
        position: 0, album: '', original_title: '', original_artist: '', cover: '', genre: '' },
    ])
    const storage = new LocalKVStorage('test-playlists')
    storage.set('last_playlist_id', 'pl-42')
    const ctx = makeCtx({ storage })
    await feature.init(ctx)
    expect(ctx.player.loadTracks).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ title: 'Playlist Song' }),
    ]))
  })

  it('saves session on APP_CLOSE when track is active', async () => {
    transport.setResponse('load_session', [])
    transport.setResponse('save_session', undefined)
    const ctx = makeCtx({
      player: {
        play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
        next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
        loadTracks: vi.fn(),
        getState: vi.fn(() => ({
          status: 'PLAYING' as const,
          track: { id: '1', title: 'T', artist: 'A', source: 'local', sourceId: '/a.mp3', duration: 200 },
          timeElapsed: 0, duration: 200,
        })),
      },
    })
    await feature.init(ctx)
    ctx.events.emit(EVENTS.APP_CLOSE, undefined)
    // Give async handler time to execute
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.calls.some((c) => c.command === 'save_session')).toBe(true)
  })

  it('destroy cleans up listeners', async () => {
    transport.setResponse('load_session', [])
    transport.setResponse('save_session', undefined)
    const ctx = makeCtx()
    await feature.init(ctx)
    feature.destroy()
    transport.reset()
    ctx.events.emit(EVENTS.APP_CLOSE, undefined)
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.calls.some((c) => c.command === 'save_session')).toBe(false)
  })

  it('exposes service getter', () => {
    expect(feature.service).toBeDefined()
  })
})
