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
    ui: { registerPanel: vi.fn(), registerShortcut: vi.fn(), registerMenuItem: vi.fn(), togglePanel: vi.fn() },
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

  it('updates peerCount when PEERS_UPDATED is emitted on ctx.events', async () => {
    const ctx = makeCtx()
    await feature.init(ctx)

    ctx.events.emit<number>(EVENTS.PEERS_UPDATED, 5)

    expect(feature.peers).toBe(5)
  })

  it('destroy stops reacting to PEERS_UPDATED', async () => {
    const ctx = makeCtx()
    await feature.init(ctx)
    feature.destroy()

    ctx.events.emit<number>(EVENTS.PEERS_UPDATED, 10)

    expect(feature.peers).toBe(0)
  })

  describe('peer-list panel', () => {
    it('init registers a panel with id "p2p-peers"', async () => {
      const ctx = makeCtx()
      await feature.init(ctx)
      expect(ctx.ui.registerPanel).toHaveBeenCalledWith('p2p-peers', expect.any(Function))
    })

    it('init registers a menu item "Peers"', async () => {
      const ctx = makeCtx()
      await feature.init(ctx)
      expect(ctx.ui.registerMenuItem).toHaveBeenCalledWith('Peers', expect.any(Function), 'peers')
    })

    it('the "Peers" menu item toggles the p2p-peers panel', async () => {
      const ctx = makeCtx()
      await feature.init(ctx)
      const handler = (ctx.ui.registerMenuItem as ReturnType<typeof vi.fn>).mock.calls[0][1]
      handler()
      expect(ctx.ui.togglePanel).toHaveBeenCalledWith('p2p-peers')
    })

    it('panel render shows the current peer count', async () => {
      transport.setResponse('p2p_peers', [])
      const ctx = makeCtx()
      await feature.init(ctx)
      ctx.events.emit<number>(EVENTS.PEERS_UPDATED, 3)

      const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
      const el = render() as HTMLElement

      expect(el.textContent).toContain('3')
    })

    it('panel render shows peer list rows', async () => {
      transport.setResponse('p2p_peers', [
        { id: 'peer-abcdefghij', addrs: ['/ip4/1.2.3.4/tcp/9000'] },
        { id: 'peer-def', addrs: ['/ip4/5.6.7.8/tcp/9000'] },
      ])
      const ctx = makeCtx()
      await feature.init(ctx)

      const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
      const el = render() as HTMLElement
      await new Promise((r) => setTimeout(r, 10))

      expect(el.textContent).toContain('peer-abc')
      expect(el.textContent).toContain('peer-def')
    })

    it('panel render shows "No peers" when list is empty', async () => {
      transport.setResponse('p2p_peers', [])
      const ctx = makeCtx()
      await feature.init(ctx)

      const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
      const el = render() as HTMLElement
      await new Promise((r) => setTimeout(r, 10))

      expect(el.textContent).toContain('No peers')
    })
  })
})
