import { describe, it, expect, vi } from 'vitest'
import { PlayerEvents } from './PlayerEvents'
import type { TrackInfo } from './PlayerStore'

function makeStore(onTrackChange: (cb: any) => () => void) {
  return { onTrackChange } as any
}

describe('PlayerEvents', () => {
  it('calls subscriber when track changes', () => {
    let storedCb: ((t: TrackInfo | null) => void) | null = null
    const store = makeStore((cb) => { storedCb = cb; return () => {} })
    const events = new PlayerEvents(store)

    const listener = vi.fn()
    events.onTrackChange(listener)

    const track: TrackInfo = { url: '/a.mp3', metaData: { artist: 'A', title: 'B' } }
    storedCb!(track)

    expect(listener).toHaveBeenCalledWith(track)
  })

  it('supports multiple subscribers', () => {
    let storedCb: ((t: TrackInfo | null) => void) | null = null
    const store = makeStore((cb) => { storedCb = cb; return () => {} })
    const events = new PlayerEvents(store)

    const a = vi.fn(), b = vi.fn()
    events.onTrackChange(a)
    events.onTrackChange(b)
    storedCb!(null)

    expect(a).toHaveBeenCalledWith(null)
    expect(b).toHaveBeenCalledWith(null)
  })

  it('unsubscribe removes listener', () => {
    let storedCb: ((t: TrackInfo | null) => void) | null = null
    const store = makeStore((cb) => { storedCb = cb; return () => {} })
    const events = new PlayerEvents(store)

    const listener = vi.fn()
    const unsub = events.onTrackChange(listener)
    unsub()
    storedCb!(null)

    expect(listener).not.toHaveBeenCalled()
  })
})
