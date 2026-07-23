import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecommendationsFeature } from './RecommendationsFeature'
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
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn(), togglePanel: vi.fn() },
    storage: new LocalKVStorage('test-recs'),
    transport,
  }
}

const track: Track = {
  id: 'cid-1', title: 'Song', artist: 'Artist', duration: 200,
  source: 'local', sourceId: '/a.mp3',
}

describe('RecommendationsFeature', () => {
  let transport: MockTransport
  let feature: RecommendationsFeature
  let ctx: ModuleContext

  beforeEach(() => {
    transport = new MockTransport()
    transport.setResponse('feature_flags_list', [
      { key: 'recommendations', enabled: true, description: '' },
    ])
    feature = new RecommendationsFeature(transport)
    ctx = makeCtx(transport)
  })

  afterEach(() => feature.destroy())

  it('has id "recommendations"', () => {
    expect(feature.id).toBe('recommendations')
  })

  it('syncs profile on TRACK_END when feature is enabled', async () => {
    transport.setResponse('sync_profile', 5)
    await feature.init(ctx)

    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 180 })
    await new Promise((r) => setTimeout(r, 10))

    expect(transport.calls.some((c) => c.command === 'sync_profile')).toBe(true)
  })

  it('does not sync profile when recommendations flag is disabled', async () => {
    transport.setResponse('feature_flags_list', [
      { key: 'recommendations', enabled: false, description: '' },
    ])
    transport.setResponse('sync_profile', 0)
    feature = new RecommendationsFeature(transport)
    await feature.init(ctx)

    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 180 })
    await new Promise((r) => setTimeout(r, 10))

    expect(transport.calls.some((c) => c.command === 'sync_profile')).toBe(false)
  })

  it('destroy stops syncing', async () => {
    transport.setResponse('sync_profile', 0)
    await feature.init(ctx)
    feature.destroy()
    transport.reset()

    ctx.events.emit(EVENTS.TRACK_END, { track, timeElapsed: 180 })
    await new Promise((r) => setTimeout(r, 10))
    expect(transport.calls).toHaveLength(0)
  })

  it('exposes service and historyService getters', async () => {
    await feature.init(ctx)
    expect(feature.service).toBeDefined()
    expect(feature.historyService).toBeDefined()
  })
})
