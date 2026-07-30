import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChartsFeature } from './ChartsFeature'
import { MockTransport } from '../../services/transport'
import { EventBus } from '../../core/EventBus'
import { LocalKVStorage } from '../../core/KVStorage'
import type { ModuleContext } from '../../core/ModuleContext'

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
    storage: new LocalKVStorage('test-charts'),
    transport,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ChartsFeature', () => {
  let transport: MockTransport
  let feature: ChartsFeature

  beforeEach(() => {
    transport = new MockTransport()
    transport.setResponse('get_top_tracks_cmd', [])
    feature = new ChartsFeature(transport)
  })

  it('has id "charts"', () => {
    expect(feature.id).toBe('charts')
  })

  it('init registers a panel with id "charts"', async () => {
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    expect(ctx.ui.registerPanel).toHaveBeenCalledWith('charts', expect.any(Function))
  })

  it('init registers a menu item "Charts"', async () => {
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    expect(ctx.ui.registerMenuItem).toHaveBeenCalledWith('Charts', expect.any(Function))
  })

  it('the "Charts" menu item toggles the charts panel', async () => {
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const handler = (ctx.ui.registerMenuItem as ReturnType<typeof vi.fn>).mock.calls[0][1]
    handler()
    expect(ctx.ui.togglePanel).toHaveBeenCalledWith('charts')
  })

  it('panel renders ranked rows with title, artist and play count', async () => {
    transport.setResponse('get_top_tracks_cmd', [
      { canonical_id: 'a', artist: 'Artist1', title: 'Song1', play_count: 10 },
      { canonical_id: 'b', artist: 'Artist2', title: 'Song2', play_count: 5 },
    ])
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const el = render() as HTMLElement
    await flush()

    expect(el.textContent).toContain('Song1')
    expect(el.textContent).toContain('Artist1')
    expect(el.textContent).toContain('10')
    expect(el.textContent).toContain('Song2')
  })

  it('panel shows empty state when there are no tracks', async () => {
    transport.setResponse('get_top_tracks_cmd', [])
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const el = render() as HTMLElement
    await flush()

    expect(el.textContent).toContain('No plays yet')
  })

  it('panel loads the week period by default', async () => {
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
    render()
    await flush()
    expect(transport.lastCall?.args).toEqual({ period: 'week', limit: 50 })
  })

  it('clicking a period button re-queries with the new period', async () => {
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const el = render() as HTMLElement
    await flush()

    const monthBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Month')!
    monthBtn.click()
    await flush()

    expect(transport.lastCall?.args).toEqual({ period: 'month', limit: 50 })
  })

  it('clicking Community loads network-aggregated charts', async () => {
    transport.setResponse('get_community_charts_cmd', [
      { canonical_id: 'c', artist: 'PeerArtist', title: 'PeerSong', play_count: 42 },
    ])
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const el = render() as HTMLElement
    await flush()

    const communityBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Community')!
    communityBtn.click()
    await flush()

    expect(transport.lastCall?.command).toBe('get_community_charts_cmd')
    expect(el.textContent).toContain('PeerSong')
    expect(el.textContent).toContain('42')
  })

  it('panel shows error state when the query fails', async () => {
    transport.setResponse('get_top_tracks_cmd', new Error('boom'))
    const ctx = makeCtx(transport)
    await feature.init(ctx)
    const render = (ctx.ui.registerPanel as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const el = render() as HTMLElement
    await flush()

    expect(el.textContent).toContain('Could not load charts')
  })

  it('destroy does not throw', () => {
    expect(() => feature.destroy()).not.toThrow()
  })
})
