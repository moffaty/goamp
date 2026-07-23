import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScrobbleFeature } from './ScrobbleFeature'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import { EVENTS } from '../../core/events'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track } from '../../core/types'

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
    storage: new LocalKVStorage('test-scrobble'),
    transport,
  }
}

const track: Track = {
  id: '', title: 'Song', artist: 'Artist', duration: 200,
  source: 'local', sourceId: '/a.mp3',
}

describe('ScrobbleFeature', () => {
  let transport: MockTransport
  let feature: ScrobbleFeature
  let ctx: ModuleContext

  beforeEach(async () => {
    transport = new MockTransport()
    transport.setResponse('feature_flags_list', [
      { key: 'auto_scrobble', enabled: true, description: '' },
      { key: 'lastfm_scrobble', enabled: true, description: '' },
      { key: 'listenbrainz_scrobble', enabled: true, description: '' },
    ])
    feature = new ScrobbleFeature(transport)
    ctx = makeCtx(transport)
  })

  afterEach(() => feature.destroy())

  it('has id "scrobble"', () => {
    expect(feature.id).toBe('scrobble')
  })

  it('calls lastfm_now_playing when track starts and lastfm is connected', async () => {
    localStorage.setItem('goamp_lastfm_enabled', '1')
    transport.setResponse('lastfm_get_status', 'user')
    transport.setResponse('lastfm_now_playing', undefined)
    transport.setResponse('listenbrainz_get_status', null)

    await feature.init(ctx)
    ctx.events.emit(EVENTS.TRACK_START, track)
    await new Promise((r) => setTimeout(r, 20))

    expect(transport.calls.some((c) => c.command === 'lastfm_now_playing')).toBe(true)
  })

  it('calls listenbrainz_now_playing when lb is connected', async () => {
    localStorage.setItem('goamp_lb_enabled', '1')
    transport.setResponse('listenbrainz_get_status', 'user-token')
    transport.setResponse('listenbrainz_now_playing', undefined)
    transport.setResponse('lastfm_get_status', null)

    await feature.init(ctx)
    ctx.events.emit(EVENTS.TRACK_START, track)
    await new Promise((r) => setTimeout(r, 20))

    expect(transport.calls.some((c) => c.command === 'listenbrainz_now_playing')).toBe(true)
  })

  it('does not scrobble when auto_scrobble flag is disabled', async () => {
    transport.setResponse('feature_flags_list', [
      { key: 'auto_scrobble', enabled: false, description: '' },
    ])
    localStorage.setItem('goamp_lastfm_enabled', '1')
    transport.setResponse('lastfm_get_status', 'user')

    await feature.init(ctx)
    ctx.events.emit(EVENTS.TRACK_START, track)
    await new Promise((r) => setTimeout(r, 20))

    expect(transport.calls.some((c) => c.command === 'lastfm_now_playing')).toBe(false)
  })

  it('does not scrobble when neither service is enabled in localStorage', async () => {
    localStorage.removeItem('goamp_lastfm_enabled')
    localStorage.removeItem('goamp_lb_enabled')

    await feature.init(ctx)
    ctx.events.emit(EVENTS.TRACK_START, track)
    await new Promise((r) => setTimeout(r, 20))

    expect(transport.calls.some((c) => c.command === 'lastfm_now_playing')).toBe(false)
  })

  it('exposes service getter', async () => {
    await feature.init(ctx)
    expect(feature.service).toBeDefined()
  })

  it('destroy clears timers without throwing', async () => {
    await feature.init(ctx)
    expect(() => feature.destroy()).not.toThrow()
  })
})
