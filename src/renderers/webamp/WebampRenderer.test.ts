import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebampRenderer } from './WebampRenderer'
import type { Track, PlaybackState } from '../../core/types'

function makeWebamp(initialStatus: 'STOPPED' | 'PLAYING' | 'PAUSED' = 'STOPPED') {
  let statusCb: (() => void) | null = null
  let trackCb: ((t: any) => void) | null = null
  let closeCb: (() => void) | null = null

  const storeState: any = {
    media: { status: initialStatus, timeElapsed: 0 },
    playlist: { tracks: {}, trackOrder: [] },
    windows: { genWindows: {} },
    milkdrop: {},
  }

  const store = {
    getState: () => storeState,
    dispatch: vi.fn(),
    subscribe: vi.fn((cb: () => void) => {
      statusCb = () => cb()
      return () => { statusCb = null }
    }),
  }

  const webamp: any = {
    store,
    renderWhenReady: vi.fn(async () => {}),
    setTracksToPlay: vi.fn(),
    onTrackDidChange: vi.fn((cb: any) => { trackCb = cb; return () => {} }),
    onWillClose: vi.fn((cb: () => void) => { closeCb = cb }),
    _simulateStatus: (s: string) => {
      storeState.media.status = s
      statusCb?.()
    },
    _simulateTrackChange: (t: any) => trackCb?.(t),
    _simulateClose: () => closeCb?.(),
  }
  return webamp
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    title: 'Song',
    artist: 'Artist',
    source: 'local',
    sourceId: '/a.mp3',
    streamUrl: 'http://stream/a.mp3',
    duration: 180,
    ...overrides,
  }
}

describe('WebampRenderer', () => {
  let webamp: ReturnType<typeof makeWebamp>
  let renderer: WebampRenderer
  let container: HTMLElement

  beforeEach(async () => {
    webamp = makeWebamp()
    renderer = new WebampRenderer(webamp)
    container = document.createElement('div')
  })

  it('has id "webamp"', () => {
    expect(renderer.id).toBe('webamp')
  })

  it('mount calls renderWhenReady with container', async () => {
    await renderer.mount(container, {} as any)
    expect(webamp.renderWhenReady).toHaveBeenCalledWith(container)
  })

  it('setTracks converts Track[] to webamp format', async () => {
    await renderer.mount(container, {} as any)
    const track = makeTrack()
    renderer.setTracks([track])
    expect(webamp.setTracksToPlay).toHaveBeenCalledWith([
      { url: 'http://stream/a.mp3', duration: 180, metaData: { artist: 'Artist', title: 'Song' } },
    ])
  })

  it('setTracks uses empty string when streamUrl missing', async () => {
    await renderer.mount(container, {} as any)
    renderer.setTracks([makeTrack({ streamUrl: undefined })])
    const call = webamp.setTracksToPlay.mock.calls[0][0]
    expect(call[0].url).toBe('')
  })

  it('setPlaybackState PLAYING dispatches PLAY to Redux', async () => {
    await renderer.mount(container, {} as any)
    const state: PlaybackState = { status: 'PLAYING', track: null, timeElapsed: 0, duration: 0 }
    renderer.setPlaybackState(state)
    expect(webamp.store.dispatch).toHaveBeenCalledWith({ type: 'PLAY' })
  })

  it('setPlaybackState PAUSED dispatches PAUSE', async () => {
    await renderer.mount(container, {} as any)
    renderer.setPlaybackState({ status: 'PAUSED', track: null, timeElapsed: 0, duration: 0 })
    expect(webamp.store.dispatch).toHaveBeenCalledWith({ type: 'PAUSE' })
  })

  it('setPlaybackState STOPPED dispatches STOP', async () => {
    await renderer.mount(container, {} as any)
    renderer.setPlaybackState({ status: 'STOPPED', track: null, timeElapsed: 0, duration: 0 })
    expect(webamp.store.dispatch).toHaveBeenCalledWith({ type: 'STOP' })
  })

  it('onUserPlay callback fires when Webamp status → PLAYING', async () => {
    await renderer.mount(container, {} as any)
    const cb = vi.fn()
    renderer.onUserPlay(cb)
    webamp._simulateStatus('PLAYING')
    expect(cb).toHaveBeenCalled()
  })

  it('onUserPause callback fires when Webamp status → PAUSED', async () => {
    await renderer.mount(container, {} as any)
    const cb = vi.fn()
    renderer.onUserPause(cb)
    webamp._simulateStatus('PAUSED')
    expect(cb).toHaveBeenCalled()
  })

  it('onUserStop callback fires when Webamp status → STOPPED', async () => {
    const w = makeWebamp('PLAYING')
    const r = new WebampRenderer(w)
    await r.mount(container, {} as any)
    const cb = vi.fn()
    r.onUserStop(cb)
    w._simulateStatus('STOPPED')
    expect(cb).toHaveBeenCalled()
  })

  it('onUserClose fires when webamp.onWillClose triggers', async () => {
    await renderer.mount(container, {} as any)
    const cb = vi.fn()
    renderer.onUserClose(cb)
    webamp._simulateClose()
    expect(cb).toHaveBeenCalled()
  })

  it('destroy cleans up status subscription', async () => {
    await renderer.mount(container, {} as any)
    const cb = vi.fn()
    renderer.onUserPlay(cb)
    renderer.destroy()
    webamp._simulateStatus('PLAYING')
    expect(cb).not.toHaveBeenCalled()
  })

  it('playerStore throws before mount', () => {
    expect(() => renderer.playerStore).toThrow('not mounted')
  })

  it('playerStore returns store after mount', async () => {
    await renderer.mount(container, {} as any)
    expect(renderer.playerStore).toBeDefined()
  })
})
