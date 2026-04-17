import { describe, it, expect, vi } from 'vitest'
import { PlayerStore } from './PlayerStore'

function makeWebamp(storeState: object) {
  const store = {
    getState: () => storeState,
    dispatch: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  }
  return {
    store,
    onTrackDidChange: vi.fn(() => vi.fn()),
  } as any
}

describe('PlayerStore', () => {
  it('getStatus returns STOPPED when no state', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    expect(s.getStatus()).toBe('STOPPED')
  })

  it('getStatus returns PLAYING from media.status', () => {
    const w = makeWebamp({ media: { status: 'PLAYING' } })
    const s = new PlayerStore(w)
    expect(s.getStatus()).toBe('PLAYING')
  })

  it('getTimeElapsed returns 0 when no state', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    expect(s.getTimeElapsed()).toBe(0)
  })

  it('getTimeElapsed returns value from media.timeElapsed', () => {
    const w = makeWebamp({ media: { timeElapsed: 42 } })
    const s = new PlayerStore(w)
    expect(s.getTimeElapsed()).toBe(42)
  })

  it('dispatch calls store.dispatch', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    s.dispatch({ type: 'PLAY' })
    expect(w.store.dispatch).toHaveBeenCalledWith({ type: 'PLAY' })
  })

  it('getTracks returns ordered tracks', () => {
    const w = makeWebamp({
      playlist: {
        tracks: { a: { url: '/a.mp3', title: 'A' }, b: { url: '/b.mp3', title: 'B' } },
        trackOrder: ['b', 'a'],
      },
    })
    const s = new PlayerStore(w)
    const tracks = s.getTracks()
    expect(tracks[0].id).toBe('b')
    expect(tracks[1].id).toBe('a')
  })

  it('isMilkdropOpen returns true when milkdrop is open', () => {
    const w = makeWebamp({ windows: { genWindows: { milkdrop: { open: true } } } })
    const s = new PlayerStore(w)
    expect(s.isMilkdropOpen()).toBe(true)
  })

  it('isMilkdropOpen returns false when no state', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    expect(s.isMilkdropOpen()).toBe(false)
  })

  it('onMilkdropChange calls callback when milkdrop state changes', () => {
    let milkdropOpen = false
    let subscriber: (() => void) | null = null
    const mockStore = {
      getState: () => ({ windows: { genWindows: { milkdrop: { open: milkdropOpen } } } }),
      dispatch: vi.fn(),
      subscribe: vi.fn((cb: () => void) => { subscriber = cb; return vi.fn() }),
    }
    const w = { store: mockStore, onTrackDidChange: vi.fn(() => vi.fn()) } as any
    const s = new PlayerStore(w)
    const cb = vi.fn()
    s.onMilkdropChange(cb)

    expect(cb).not.toHaveBeenCalled()

    milkdropOpen = true
    subscriber!()
    expect(cb).toHaveBeenCalledWith(true)
    expect(cb).toHaveBeenCalledTimes(1)

    subscriber!()
    expect(cb).toHaveBeenCalledTimes(1) // no change, no call

    milkdropOpen = false
    subscriber!()
    expect(cb).toHaveBeenCalledWith(false)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('onMilkdropChange returns unsubscribe function', () => {
    const unsubscribe = vi.fn()
    const mockStore = {
      getState: () => ({}),
      dispatch: vi.fn(),
      subscribe: vi.fn(() => unsubscribe),
    }
    const w = { store: mockStore, onTrackDidChange: vi.fn(() => vi.fn()) } as any
    const s = new PlayerStore(w)
    const unsub = s.onMilkdropChange(() => {})
    unsub()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
