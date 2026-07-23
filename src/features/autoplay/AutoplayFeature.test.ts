import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { convertFileSrc } from '@tauri-apps/api/core'
import { AutoplayFeature, isAutoplayEnabled, toggleAutoplay } from './AutoplayFeature'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track, PlaybackState } from '../../core/types'
import { EVENTS } from '../../core/events'
import { blockTrack, markNormal, __resetFeedback } from './autoplay-feedback'
import { dismissOnboarding } from './autoplay-onboarding'

// ── Fakes ────────────────────────────────────────────────────────────────

function makeWebamp() {
  return { appendTracks: vi.fn() }
}

function makeCtx(storageNs = 'test-autoplay'): ModuleContext {
  return {
    player: {
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
      next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
      loadTracks: vi.fn(),
      getState: vi.fn(() => ({ status: 'STOPPED' as const, track: null, timeElapsed: 0, duration: 0 })),
    },
    events: new EventBus(),
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn() },
    storage: new LocalKVStorage(storageNs),
    transport: new MockTransport(),
  }
}

const ytResult = (id: string, title: string, channel = 'Chan') => ({
  id, title, channel, duration: 200,
  thumbnail: 't', source: 'youtube', webpage_url: '', genre: '',
})

const distinctMix = (n: number) =>
  Array.from({ length: n }, (_, i) => ytResult(`vid${i}`, `Track ${i}`, `Artist ${i}`))

const trackOf = (artist: string, title: string): Track => ({
  id: 't1', artist, title, source: 'youtube', sourceId: 'vid',
})

const autoplayTrack = (artist: string, title: string): Track => ({
  // sourceId must match the actual production protocol scheme (no hyphen).
  id: 'a1', artist, title, source: 'youtube',
  sourceId: 'http://goampaudio.localhost/abc',
})

const appendedTracks = (webamp: ReturnType<typeof makeWebamp>) =>
  webamp.appendTracks.mock.calls.flatMap((c) => c[0] as Array<{ metaData: { artist: string } }>)

const flush = () => new Promise((r) => setTimeout(r, 0))

/** A fetch stub for the playback self-test. */
function stubFetch(status: number, body = '') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    })),
  )
}

beforeEach(() => {
  localStorage.clear()
  __resetFeedback()
  document.getElementById('goamp-autoplay-onboarding')?.remove()
  document.getElementById('goamp-autoplay-nudge')?.remove()
  vi.mocked(convertFileSrc).mockClear()
  stubFetch(206) // self-test passes by default
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AutoplayFeature — basics', () => {
  it('has id "autoplay"', () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    expect(f.id).toBe('autoplay')
  })

  it('is disabled by default', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    await f.init(makeCtx())
    expect(f.enabled).toBe(false)
  })

  it('restores enabled state from storage', async () => {
    const ctx = makeCtx()
    ctx.storage.set('autoplay', '1')
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    await f.init(ctx)
    expect(f.enabled).toBe(true)
  })

  it('setEnabled persists to storage', async () => {
    const ctx = makeCtx()
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    await f.init(ctx)
    f.setEnabled(true)
    expect(ctx.storage.get<string>('autoplay')).toBe('1')
    f.setEnabled(false)
    expect(ctx.storage.get<string>('autoplay')).toBe('0')
  })

  it('module isAutoplayEnabled / toggleAutoplay delegate to the live instance', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    await f.init(makeCtx())
    expect(isAutoplayEnabled()).toBe(false)
    toggleAutoplay()
    expect(isAutoplayEnabled()).toBe(true)
    expect(f.enabled).toBe(true)
  })

  it('does NOT refill when disabled', async () => {
    const webamp = makeWebamp()
    const f = new AutoplayFeature(webamp as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)

    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('A', 'B'))
    await flush()

    expect(webamp.appendTracks).not.toHaveBeenCalled()
  })
})

describe('AutoplayFeature — instant playlist', () => {
  it('fills the queue with ~20 similar tracks in ONE bulk append', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(25))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Twenty One Pilots', 'Routines'))
    await flush()

    expect(webamp.appendTracks).toHaveBeenCalledTimes(1)
    expect(webamp.appendTracks.mock.calls[0][0]).toHaveLength(20)
  })

  it('does NOT download any audio at append time (lazy via goampaudio)', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(25))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    expect(transport.calls.some((c) => c.command.startsWith('extract_audio'))).toBe(false)
  })

  it('appends tracks via the goampaudio:// protocol scheme', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    expect(vi.mocked(convertFileSrc)).toHaveBeenCalled()
    expect(
      vi.mocked(convertFileSrc).mock.calls
        .filter((c) => c[1] !== undefined)
        .every((c) => c[1] === 'goampaudio'),
    ).toBe(true)
  })

  it('caps tracks per artist — the queue is varied, not one band', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', [
      ytResult('s1', 'T1', 'SameBand'), ytResult('s2', 'T2', 'SameBand'),
      ytResult('s3', 'T3', 'SameBand'), ytResult('s4', 'T4', 'SameBand'),
      ytResult('s5', 'T5', 'SameBand'), ytResult('s6', 'T6', 'SameBand'),
      ...distinctMix(20),
    ])

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('SameBand', 'Routines'))
    await flush()

    const sameBand = appendedTracks(webamp).filter((t) => t.metaData.artist === 'SameBand')
    expect(sameBand.length).toBeLessThanOrEqual(2)
  })
})

describe('AutoplayFeature — self-test gate', () => {
  it('does NOT append anything when the playback protocol self-test fails', async () => {
    stubFetch(502, 'resolve failed: yt-dlp not found')
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(25))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    // Protocol broken → queue is NOT flooded with un-playable tracks.
    expect(webamp.appendTracks).not.toHaveBeenCalled()
  })
})

describe('AutoplayFeature — flood control', () => {
  it('does NOT refill again while the queue is still full', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(25))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true

    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()
    expect(webamp.appendTracks).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 5; i++) {
      ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack(`A${i}`, `T${i}`))
      await flush()
    }
    expect(webamp.appendTracks).toHaveBeenCalledTimes(1) // no flood
  })

  it('refills again once the queue drains (tracks spaced out in time)', async () => {
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)

    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(25))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true

    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()
    expect(webamp.appendTracks).toHaveBeenCalledTimes(1)

    // Drain 18 tracks, each well-spaced (real playback) → no circuit breaker.
    for (let i = 0; i < 18; i++) {
      clock += 200_000
      ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack(`A${i}`, `T${i}`))
      await flush()
    }
    expect(webamp.appendTracks).toHaveBeenCalledTimes(2)
  })

  it('circuit breaker stops refills when tracks skip rapidly', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000) // time frozen → all rapid

    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(25))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true

    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()
    expect(webamp.appendTracks).toHaveBeenCalledTimes(1)

    // 18 instant skips → breaker trips → the drained queue is NOT refilled.
    for (let i = 0; i < 18; i++) {
      ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack(`A${i}`, `T${i}`))
      await flush()
    }
    expect(webamp.appendTracks).toHaveBeenCalledTimes(1)
  })
})

describe('AutoplayFeature — user feedback (block/like)', () => {
  it('filters blocked tracks out of the autoplay batch', async () => {
    blockTrack('Artist 0', 'Track 0') // a track that would otherwise come back

    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    const appended = appendedTracks(webamp)
    expect(appended.some((t) => t.metaData.artist === 'Artist 0')).toBe(false)
    // Other tracks still appended
    expect(appended.length).toBeGreaterThan(0)
  })

  it('the D hotkey blocks the currently playing track', async () => {
    const webamp = makeWebamp()
    const f = new AutoplayFeature(webamp as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('Daft Punk', 'One More Time')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))

    expect(JSON.parse(localStorage.getItem('autoplay:blocked') ?? '[]')).toContain(
      'daft punk|one more time',
    )
  })

  it('the N hotkey marks the currently playing track as normal', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('Daft Punk', 'One More Time')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))

    expect(JSON.parse(localStorage.getItem('autoplay:normal') ?? '[]')).toContain(
      'daft punk|one more time',
    )
  })

  it('the L hotkey likes the currently playing track', async () => {
    const webamp = makeWebamp()
    const f = new AutoplayFeature(webamp as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('Daft Punk', 'One More Time')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))

    expect(JSON.parse(localStorage.getItem('autoplay:liked') ?? '[]')).toContain(
      'daft punk|one more time',
    )
  })

  it('hotkeys are ignored while typing in an input', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('A', 'B')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))

    expect(localStorage.getItem('autoplay:blocked')).toBeNull()
    input.remove()
  })
})

describe('AutoplayFeature — auto-feedback on TRACK_END', () => {
  it('skip < 10s on an autoplay track → auto-block', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)

    const t: Track = {
      id: '', artist: 'A1', title: 'T1', source: 'youtube',
      sourceId: 'http://goampaudio.localhost/v1', duration: 200,
    }
    ctx.events.emit(EVENTS.TRACK_END, { track: t, timeElapsed: 4 })
    await flush()

    expect(JSON.parse(localStorage.getItem('autoplay:blocked') ?? '[]')).toContain('a1|t1')
  })

  it('completed ≥80% on an autoplay track → auto-like', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)

    const t: Track = {
      id: '', artist: 'A2', title: 'T2', source: 'youtube',
      sourceId: 'http://goampaudio.localhost/v2', duration: 200,
    }
    ctx.events.emit(EVENTS.TRACK_END, { track: t, timeElapsed: 180 })
    await flush()

    expect(JSON.parse(localStorage.getItem('autoplay:liked') ?? '[]')).toContain('a2|t2')
  })

  it('does NOT auto-feedback a user-picked (non-autoplay) track', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)

    const t: Track = {
      id: '', artist: 'A3', title: 'T3', source: 'youtube', sourceId: 'vid', duration: 200,
    }
    ctx.events.emit(EVENTS.TRACK_END, { track: t, timeElapsed: 4 })
    await flush()

    expect(localStorage.getItem('autoplay:blocked')).toBeNull()
  })

  it('does NOT override an explicit user rating', async () => {
    markNormal('A4', 'T4') // user said "neutral" — auto-feedback must respect that
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)

    const t: Track = {
      id: '', artist: 'A4', title: 'T4', source: 'youtube',
      sourceId: 'http://goampaudio.localhost/v4', duration: 200,
    }
    ctx.events.emit(EVENTS.TRACK_END, { track: t, timeElapsed: 2 })
    await flush()

    expect(localStorage.getItem('autoplay:blocked')).toBeNull()
    expect(JSON.parse(localStorage.getItem('autoplay:normal') ?? '[]')).toContain('a4|t4')
  })
})

describe('AutoplayFeature — onboarding & nudge', () => {
  it('shows the onboarding card the first time autoplay is enabled', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    expect(document.getElementById('goamp-autoplay-onboarding')).toBeNull()

    f.setEnabled(true)
    expect(document.getElementById('goamp-autoplay-onboarding')).not.toBeNull()
  })

  it('does not show the onboarding twice', async () => {
    dismissOnboarding() // user already saw it in a previous session
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    f.setEnabled(true)
    expect(document.getElementById('goamp-autoplay-onboarding')).toBeNull()
  })

  it('shows the onboarding on init if autoplay was already enabled', async () => {
    const ctx = makeCtx()
    ctx.storage.set('autoplay', '1')
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    await f.init(ctx)
    expect(document.getElementById('goamp-autoplay-onboarding')).not.toBeNull()
  })

  it('the L / D / N hotkeys dismiss the onboarding card', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    f.setEnabled(true)
    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('A', 'B')

    expect(document.getElementById('goamp-autoplay-onboarding')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }))
    expect(document.getElementById('goamp-autoplay-onboarding')).toBeNull()
  })

  it('nudges the user to rate every N autoplay tracks if the track is unrated', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    dismissOnboarding()
    f.enabled = true

    // 5 autoplay tracks → nudge appears on the 5th
    for (let i = 0; i < 5; i++) {
      ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack(`A${i}`, `T${i}`))
      await flush()
    }
    const nudge = document.getElementById('goamp-autoplay-nudge')
    expect(nudge).not.toBeNull()
    expect(nudge?.style.display).not.toBe('none')
    expect(nudge?.textContent).toContain('Rate this track')
  })

  it('does NOT nudge for a track that is already rated', async () => {
    blockTrack('A4', 'T4') // pre-rate the would-be-nudged track
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    dismissOnboarding()
    f.enabled = true

    for (let i = 0; i < 5; i++) {
      ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack(`A${i}`, `T${i}`))
      await flush()
    }
    const nudge = document.getElementById('goamp-autoplay-nudge')
    expect(nudge === null || nudge.style.display === 'none').toBe(true)
  })

  it('any of L / D / N hides the nudge', async () => {
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    const ctx = makeCtx()
    await f.init(ctx)
    dismissOnboarding()
    f.enabled = true

    for (let i = 0; i < 5; i++) {
      ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack(`A${i}`, `T${i}`))
      await flush()
    }
    expect(document.getElementById('goamp-autoplay-nudge')?.style.display).not.toBe('none')

    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('A4', 'T4')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))
    expect(document.getElementById('goamp-autoplay-nudge')?.style.display).toBe('none')
  })
})

describe('AutoplayFeature — queue persistence', () => {
  it('restores the saved queue on init (survives restart)', async () => {
    const ctx = makeCtx()
    ctx.storage.set('autoplay:queue', [
      { videoId: 'v1', artist: 'A1', title: 'T1', duration: 200 },
      { videoId: 'v2', artist: 'A2', title: 'T2', duration: 180 },
    ])
    const webamp = makeWebamp()
    const f = new AutoplayFeature(webamp as never, new MockTransport())
    await f.init(ctx)

    expect(webamp.appendTracks).toHaveBeenCalledTimes(1)
    expect(webamp.appendTracks.mock.calls[0][0]).toHaveLength(2)
  })

  it('saves the queue on each append', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    const saved = ctx.storage.get<unknown[]>('autoplay:queue')
    expect(Array.isArray(saved)).toBe(true)
    expect((saved ?? []).length).toBeGreaterThan(0)
  })

  it('drops the consumed track from the saved queue on autoplay TRACK_START', async () => {
    const ctx = makeCtx()
    ctx.storage.set('autoplay:queue', [
      { videoId: 'v1', artist: 'A1', title: 'T1' },
      { videoId: 'v2', artist: 'A2', title: 'T2' },
    ])
    const f = new AutoplayFeature(makeWebamp() as never, new MockTransport())
    await f.init(ctx)

    ctx.events.emit<Track>(EVENTS.TRACK_START, autoplayTrack('A1', 'T1'))
    await flush()

    const remaining = ctx.storage.get<unknown[]>('autoplay:queue') ?? []
    expect(remaining).toHaveLength(1)
  })
})

describe('AutoplayFeature — refill at end of queue', () => {
  it('PLAYBACK_CHANGE → STOPPED triggers a refill (queue ended)', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    // Seed currentTrack so the cold-start branch has a YouTube seed, but DO
    // NOT fire a TRACK_START — we want STOPPED to be the only trigger.
    ;(f as unknown as { currentTrack: Track }).currentTrack = trackOf('Cur', 'Song')
    // Webamp queue is empty (no prior TRACK_START with autoplay url) → STOPPED
    // event is what fires the refill — that is exactly the end-of-queue case.
    ctx.events.emit<PlaybackState>(EVENTS.PLAYBACK_CHANGE, {
      status: 'STOPPED', track: null, timeElapsed: 0, duration: 0,
    })
    await flush()

    expect(webamp.appendTracks).toHaveBeenCalled()
  })

  it('STOPPED while autoplay is OFF does nothing', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    // enabled stays false

    ctx.events.emit<PlaybackState>(EVENTS.PLAYBACK_CHANGE, {
      status: 'STOPPED', track: null, timeElapsed: 0, duration: 0,
    })
    await flush()

    expect(webamp.appendTracks).not.toHaveBeenCalled()
  })
})

describe('AutoplayFeature — recommendation sources', () => {
  it('seeds the YouTube Mix from the TRACK_START event, not the Webamp store', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Twenty One Pilots', 'Routines'))
    await flush()

    const search = transport.calls.find((c) => c.command === 'search_youtube')
    expect(String(search?.args?.query)).toContain('Twenty One Pilots')
    expect(webamp.appendTracks).toHaveBeenCalled()
  })

  it('prefers GOAMP hybrid recommendations — YouTube Mix not touched when GOAMP has enough', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse(
      'get_hybrid_recommendations',
      Array.from({ length: 25 }, (_, i) => [`c${i}`, 0.9, 's', `Artist ${i}`, `Title ${i}`]),
    )
    transport.setResponse('search_youtube', [ytResult('found', 'f')])

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    expect(transport.calls.some((c) => c.command === 'youtube_get_playlist')).toBe(false)
    expect(webamp.appendTracks).toHaveBeenCalled()
  })

  it('falls back to a same-artist search when the YouTube Mix is empty', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', distinctMix(8))
    transport.setResponse('youtube_get_playlist', [])

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Twenty One Pilots', 'Routines'))
    await flush()

    expect(webamp.appendTracks).toHaveBeenCalled()
    expect(appendedTracks(webamp).length).toBeGreaterThan(0)
  })

  it('does not recommend the currently playing track back into the queue', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [['cid', 0.9, 's', 'Cur', 'Song']])
    transport.setResponse('search_youtube', [ytResult('vid', 'Song', 'Cur')])
    transport.setResponse('youtube_get_playlist', [ytResult('vid', 'Song', 'Cur')])

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    expect(webamp.appendTracks).not.toHaveBeenCalled()
  })

  it('destroy stops reacting to TRACK_START', async () => {
    const webamp = makeWebamp()
    const transport = new MockTransport()
    transport.setResponse('get_hybrid_recommendations', [])
    transport.setResponse('search_youtube', [ytResult('seed', 's')])
    transport.setResponse('youtube_get_playlist', distinctMix(5))

    const f = new AutoplayFeature(webamp as never, transport)
    const ctx = makeCtx()
    await f.init(ctx)
    f.enabled = true
    f.destroy()

    ctx.events.emit<Track>(EVENTS.TRACK_START, trackOf('Cur', 'Song'))
    await flush()

    expect(webamp.appendTracks).not.toHaveBeenCalled()
  })
})
