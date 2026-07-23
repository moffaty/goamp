import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HistoryFeature } from './HistoryFeature'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import { EVENTS } from '../../core/events'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track } from '../../core/types'

function makeCtx(): ModuleContext {
  return {
    player: {
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
      next: vi.fn(), prev: vi.fn(), seek: vi.fn(),
      loadTracks: vi.fn(),
      getState: vi.fn(() => ({ status: 'STOPPED' as const, track: null, timeElapsed: 0, duration: 0 })),
    },
    events: new EventBus(),
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn(), togglePanel: vi.fn() },
    storage: new LocalKVStorage('test-history'),
    transport: new MockTransport(),
  }
}

const track: Track = {
  id: '', title: 'Song', artist: 'Artist', duration: 200,
  source: 'local', sourceId: '/a.mp3',
}

describe('HistoryFeature', () => {
  let transport: MockTransport
  let feature: HistoryFeature
  let ctx: ModuleContext

  beforeEach(async () => {
    transport = new MockTransport()
    feature = new HistoryFeature(transport)
    ctx = makeCtx()
    await feature.init(ctx)
  })

  it('has id "history"', () => {
    expect(feature.id).toBe('history')
  })

  it('resolves track id and records listen on TRACK_END', async () => {
    transport.setResponse('resolve_track_id', 'cid-1')
    transport.setResponse('record_track_listen', undefined)

    ctx.events.emit(EVENTS.TRACK_START, track)
    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 160 })
    await new Promise((r) => setTimeout(r, 10))

    expect(transport.calls.some((c) => c.command === 'resolve_track_id')).toBe(true)
    expect(transport.calls.some((c) => c.command === 'record_track_listen')).toBe(true)
  })

  it('marks listen as completed when listened >= 80% of duration', async () => {
    transport.setResponse('resolve_track_id', 'cid-1')
    transport.setResponse('record_track_listen', undefined)

    ctx.events.emit(EVENTS.TRACK_START, track)
    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 180 }) // 90% of 200s
    await new Promise((r) => setTimeout(r, 10))

    const call = transport.calls.find((c) => c.command === 'record_track_listen')
    expect(call?.args?.completed).toBe(true)
  })

  it('marks listen as skippedEarly when listened < 10s', async () => {
    transport.setResponse('resolve_track_id', 'cid-1')
    transport.setResponse('record_track_listen', undefined)

    ctx.events.emit(EVENTS.TRACK_START, track)
    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 5 })
    await new Promise((r) => setTimeout(r, 10))

    const call = transport.calls.find((c) => c.command === 'record_track_listen')
    expect(call?.args?.skippedEarly).toBe(true)
  })

  it('skips recording when track has no sourceId', async () => {
    const noId = { ...track, sourceId: '' }
    ctx.events.emit(EVENTS.TRACK_START, noId)
    ctx.events.emit(EVENTS.TRACK_END, { track: noId, timeElapsed: 100 })
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.calls.some((c) => c.command === 'resolve_track_id')).toBe(false)
  })

  it('destroy stops listening to events', async () => {
    feature.destroy()
    transport.reset()
    transport.setResponse('resolve_track_id', 'cid-1')
    transport.setResponse('record_track_listen', undefined)

    ctx.events.emit(EVENTS.TRACK_START, track)
    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 160 })
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.calls).toHaveLength(0)
  })

  it('exposes service getter', () => {
    expect(feature.service).toBeDefined()
  })
})
