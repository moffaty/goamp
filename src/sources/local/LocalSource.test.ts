import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LocalSource } from './LocalSource'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import type { ModuleContext } from '../../core/ModuleContext'
import type { TrackMeta } from '../../lib/tauri-ipc'

// convertFileSrc is mocked in setup.ts → asset://localhost/<encoded-path>

function makeCtx(transport: MockTransport): ModuleContext {
  return {
    player: {
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
      next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
      loadTracks: vi.fn(),
      getState: vi.fn(() => ({ status: 'STOPPED' as const, track: null, timeElapsed: 0, duration: 0 })),
    },
    events: new EventBus(),
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn() },
    storage: new LocalKVStorage('test-local'),
    transport,
  }
}

const fakeMeta: TrackMeta = {
  path: '/music/song.mp3',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  genre: 'Rock',
  duration: 210,
}

describe('LocalSource', () => {
  let transport: MockTransport
  let source: LocalSource
  let ctx: ModuleContext

  beforeEach(async () => {
    transport = new MockTransport()
    source = new LocalSource(transport)
    ctx = makeCtx(transport)
    await source.init(ctx)
  })

  it('has id "local"', () => {
    expect(source.id).toBe('local')
  })

  it('registers ctrl+o and ctrl+shift+o shortcuts on init', () => {
    expect(ctx.ui.registerShortcut).toHaveBeenCalledWith('ctrl+o', expect.any(Function))
    expect(ctx.ui.registerShortcut).toHaveBeenCalledWith('ctrl+shift+o', expect.any(Function))
  })

  it('resolve returns convertFileSrc result for local tracks', async () => {
    const url = await source.resolve({ id: '', title: 'T', artist: 'A', source: 'local', sourceId: '/music/a.mp3' })
    expect(url).toBe('asset://localhost/%2Fmusic%2Fa.mp3')
  })

  it('resolve returns null for non-local tracks', async () => {
    const url = await source.resolve({ id: '', title: 'T', artist: 'A', source: 'youtube', sourceId: 'abc123' })
    expect(url).toBeNull()
  })

  it('search always returns empty array', async () => {
    expect(await source.search('anything')).toEqual([])
  })

  it('scanDirectory calls scan_directory and converts to Track[]', async () => {
    transport.setResponse('scan_directory', [fakeMeta])
    const tracks = await source.scanDirectory('/music')
    expect(transport.lastCall).toEqual({ command: 'scan_directory', args: { path: '/music' } })
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({
      title: 'Song',
      artist: 'Artist',
      source: 'local',
      sourceId: '/music/song.mp3',
      duration: 210,
    })
  })

  it('readMetadata calls read_metadata and converts to Track', async () => {
    transport.setResponse('read_metadata', fakeMeta)
    const track = await source.readMetadata('/music/song.mp3')
    expect(track).toMatchObject({ title: 'Song', artist: 'Artist', source: 'local' })
  })

  it('scanDirectory uses filename as title when title is null', async () => {
    transport.setResponse('scan_directory', [{ ...fakeMeta, title: null }])
    const tracks = await source.scanDirectory('/music')
    expect(tracks[0].title).toBe('song.mp3')
  })

  it('destroy does not throw', () => {
    expect(() => source.destroy()).not.toThrow()
  })
})
