import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P2PFeature } from './P2PFeature'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track } from '../../core/types'
import { EVENTS } from '../../core/events'

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
    storage: new LocalKVStorage('test-p2p'),
    transport: new MockTransport(),
  }
}

const fakeTrack: Track = {
  id: 't1', title: 'Song', artist: 'Artist', source: 'youtube', sourceId: 'dQw4w9WgXcQ',
}

describe('P2PFeature', () => {
  let transport: MockTransport
  let feature: P2PFeature

  beforeEach(async () => {
    transport = new MockTransport()
    feature = new P2PFeature(transport)
  })

  it('has id "p2p"', () => {
    expect(feature.id).toBe('p2p')
  })

  it('exposes service', () => {
    expect(feature.service).toBeDefined()
  })

  it('peers starts at 0', () => {
    expect(feature.peers).toBe(0)
  })

  it('TRACK_START announces track to catalog', async () => {
    transport.setResponse('p2p_catalog_announce', undefined)
    const ctx = makeCtx()
    await feature.init(ctx)

    ctx.events.emit<Track>(EVENTS.TRACK_START, fakeTrack)
    await Promise.resolve() // flush microtask

    expect(transport.lastCall?.command).toBe('p2p_catalog_announce')
    expect(transport.lastCall?.args).toEqual({ trackId: 'dQw4w9WgXcQ' })
  })

  it('TRACK_START with no sourceId skips announce', async () => {
    transport.setResponse('p2p_catalog_announce', undefined)
    const ctx = makeCtx()
    await feature.init(ctx)

    ctx.events.emit<Track>(EVENTS.TRACK_START, { ...fakeTrack, sourceId: '' })
    await Promise.resolve()

    expect(transport.calls).toHaveLength(0)
  })

  it('announce error is swallowed (non-critical)', async () => {
    transport.setResponse('p2p_catalog_announce', new Error('network'))
    const ctx = makeCtx()
    await feature.init(ctx)

    ctx.events.emit<Track>(EVENTS.TRACK_START, fakeTrack)
    await Promise.resolve()
    // no throw — just silently caught
  })

  it('destroy stops reacting to events', async () => {
    transport.setResponse('p2p_catalog_announce', undefined)
    const ctx = makeCtx()
    await feature.init(ctx)
    feature.destroy()

    ctx.events.emit<Track>(EVENTS.TRACK_START, fakeTrack)
    await Promise.resolve()

    expect(transport.calls).toHaveLength(0)
  })

  it('destroy does not throw when called without init', () => {
    expect(() => feature.destroy()).not.toThrow()
  })
})
