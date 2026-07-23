import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YouTubeSource } from './YouTubeSource'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import type { ModuleContext } from '../../core/ModuleContext'
import type { YoutubeResult } from '../../youtube/youtube-service'

function makeCtx(): ModuleContext {
  return {
    player: {
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
      next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
      loadTracks: vi.fn(),
      getState: vi.fn(() => ({ status: 'STOPPED' as const, track: null, timeElapsed: 0, duration: 0 })),
    },
    events: new EventBus(),
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn() },
    storage: new LocalKVStorage('test-yt'),
    transport: new MockTransport(),
  }
}

const fakeResult: YoutubeResult = {
  id: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  channel: 'Rick Astley',
  duration: 213,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  source: 'youtube',
  webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  genre: '',
}

describe('YouTubeSource', () => {
  let transport: MockTransport
  let source: YouTubeSource

  beforeEach(async () => {
    transport = new MockTransport()
    source = new YouTubeSource(transport)
    await source.init(makeCtx())
  })

  it('has id "youtube"', () => {
    expect(source.id).toBe('youtube')
  })

  it('resolve calls extract_audio for plain video IDs', async () => {
    transport.setResponse('extract_audio', '/cache/dQw4w9WgXcQ.opus')
    const path = await source.resolve({
      id: '', title: 'T', artist: 'A', source: 'youtube', sourceId: 'dQw4w9WgXcQ',
    })
    expect(transport.lastCall.command).toBe('extract_audio')
    expect(transport.lastCall.args).toEqual({ videoId: 'dQw4w9WgXcQ' })
    expect(path).toBe('/cache/dQw4w9WgXcQ.opus')
  })

  it('resolve calls extract_audio_url for full youtube URLs', async () => {
    transport.setResponse('extract_audio_url', '/cache/x.opus')
    await source.resolve({
      id: '', title: 'T', artist: 'A', source: 'youtube',
      sourceId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })
    expect(transport.lastCall.command).toBe('extract_audio_url')
  })

  it('resolve returns null for non-youtube tracks', async () => {
    const url = await source.resolve({ id: '', title: 'T', artist: 'A', source: 'local', sourceId: '/a.mp3' })
    expect(url).toBeNull()
  })

  it('resolve returns null when backend throws', async () => {
    transport.setResponse('extract_audio', new Error('no cookies'))
    const url = await source.resolve({ id: '', title: 'T', artist: 'A', source: 'youtube', sourceId: 'vid' })
    expect(url).toBeNull()
  })

  it('search calls search_youtube and maps results to Track[]', async () => {
    transport.setResponse('search_youtube', [fakeResult])
    const results = await source.search('rick astley')
    expect(transport.lastCall.command).toBe('search_youtube')
    expect(results).toHaveLength(1)
    expect(results[0].track).toMatchObject({
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      source: 'youtube',
      sourceId: 'dQw4w9WgXcQ',
    })
  })

  it('search maps thumbnail to previewUrl', async () => {
    transport.setResponse('search_youtube', [fakeResult])
    const results = await source.search('rick')
    expect(results[0].previewUrl).toBe(fakeResult.thumbnail)
  })

  it('relatedMix requests the RD<videoId> Mix playlist', async () => {
    transport.setResponse('youtube_get_playlist', [fakeResult])
    const tracks = await source.relatedMix('dQw4w9WgXcQ')
    expect(transport.lastCall.command).toBe('youtube_get_playlist')
    expect((transport.lastCall.args as { url: string }).url).toContain('list=RDdQw4w9WgXcQ')
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ source: 'youtube', sourceId: 'dQw4w9WgXcQ' })
  })

  it('destroy does not throw', () => {
    expect(() => source.destroy()).not.toThrow()
  })
})
