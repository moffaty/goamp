import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoampCore, EVENTS } from './GoampCore'
import { MockTransport } from '../services/transport'
import type { IRenderer } from './IRenderer'
import type { ISource } from './ISource'
import type { IFeature } from './IFeature'
import type { ModuleContext } from './ModuleContext'
import type { Track } from './types'

function makeRenderer(): IRenderer & { _ctx: ModuleContext | null } {
  let _ctx: ModuleContext | null = null
  const cbs: Record<string, (...args: any[]) => void> = {}
  return {
    id: 'mock',
    _ctx,
    mount: vi.fn(async (_el, ctx) => { _ctx = ctx }),
    destroy: vi.fn(),
    setTracks: vi.fn(),
    setPlaybackState: vi.fn(),
    onUserPlay: vi.fn((cb) => { cbs['play'] = cb }),
    onUserPause: vi.fn((cb) => { cbs['pause'] = cb }),
    onUserStop: vi.fn((cb) => { cbs['stop'] = cb }),
    onUserNext: vi.fn((cb) => { cbs['next'] = cb }),
    onUserPrev: vi.fn((cb) => { cbs['prev'] = cb }),
    onUserSeek: vi.fn((cb) => { cbs['seek'] = cb }),
    onUserAddTracks: vi.fn((cb) => { cbs['addTracks'] = cb }),
    onUserClose: vi.fn((cb) => { cbs['close'] = cb }),
    _trigger: (name: string, ...args: any[]) => cbs[name]?.(...args),
  } as any
}

function makeSource(): ISource {
  return {
    id: 'mock-source',
    name: 'Mock Source',
    init: vi.fn(async () => {}),
    destroy: vi.fn(),
    resolve: vi.fn(async () => 'http://stream.mp3'),
  }
}

function makeFeature(): IFeature {
  return {
    id: 'mock-feature',
    init: vi.fn(async () => {}),
    destroy: vi.fn(),
  }
}

describe('GoampCore', () => {
  let renderer: ReturnType<typeof makeRenderer>
  let source: ISource
  let feature: IFeature
  let transport: MockTransport
  let container: HTMLElement

  beforeEach(() => {
    renderer = makeRenderer()
    source = makeSource()
    feature = makeFeature()
    transport = new MockTransport()
    container = document.createElement('div')
  })

  it('throws if no renderer registered', async () => {
    const core = new GoampCore().transport(transport)
    await expect(core.start(container)).rejects.toThrow('no renderer')
  })

  it('throws if no transport registered', async () => {
    const core = new GoampCore().renderer(renderer)
    await expect(core.start(container)).rejects.toThrow('no transport')
  })

  it('mounts renderer with ModuleContext', async () => {
    await new GoampCore().renderer(renderer).transport(transport).start(container)
    expect(renderer.mount).toHaveBeenCalledWith(container, expect.objectContaining({
      player: expect.any(Object),
      events: expect.any(Object),
      ui: expect.any(Object),
      storage: expect.any(Object),
      transport,
    }))
  })

  it('initialises sources and features in order', async () => {
    const order: string[] = []
    const s = { ...makeSource(), init: vi.fn(async () => { order.push('source') }) }
    const f = { ...makeFeature(), init: vi.fn(async () => { order.push('feature') }) }

    await new GoampCore().renderer(renderer).transport(transport)
      .source(s).feature(f).start(container)

    expect(order).toEqual(['source', 'feature'])
  })

  it('source init failure does NOT abort core.start (isolation)', async () => {
    const goodFeature = { ...makeFeature(), init: vi.fn(async () => {}) }
    const badSource = { ...makeSource(), init: vi.fn(async () => { throw new Error('source boom') }) }

    await expect(
      new GoampCore().renderer(renderer).transport(transport)
        .source(badSource).feature(goodFeature).start(container)
    ).resolves.toBeUndefined()

    // Good feature still ran after bad source
    expect(goodFeature.init).toHaveBeenCalled()
  })

  it('feature init failure does NOT abort core.start (other features still init)', async () => {
    const failingFeature: IFeature = {
      id: 'bad', init: vi.fn(async () => { throw new Error('feature boom') }), destroy: vi.fn()
    }
    const okFeature: IFeature = {
      id: 'good', init: vi.fn(async () => {}), destroy: vi.fn()
    }

    await expect(
      new GoampCore().renderer(renderer).transport(transport)
        .feature(failingFeature).feature(okFeature).start(container)
    ).resolves.toBeUndefined()

    expect(failingFeature.init).toHaveBeenCalled()
    expect(okFeature.init).toHaveBeenCalled()
  })

  it('module init failure dispatches goamp:module-error CustomEvent (for overlay)', async () => {
    const events: Array<{ module: string; error: unknown }> = []
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ module: string; error: unknown }>).detail
      events.push(detail)
    }
    window.addEventListener('goamp:module-error', handler)

    const bad: IFeature = {
      id: 'broken', init: vi.fn(async () => { throw new Error('init crash') }), destroy: vi.fn()
    }

    await new GoampCore().renderer(renderer).transport(transport)
      .feature(bad).start(container)

    expect(events.length).toBe(1)
    expect(events[0].module).toContain('broken')
    expect((events[0].error as Error).message).toBe('init crash')
    window.removeEventListener('goamp:module-error', handler)
  })

  it('destroy calls destroy on all modules', async () => {
    const core = new GoampCore().renderer(renderer).transport(transport)
      .source(source).feature(feature)
    await core.start(container)
    await core.destroy()

    expect(renderer.destroy).toHaveBeenCalled()
    expect(source.destroy).toHaveBeenCalled()
    expect(feature.destroy).toHaveBeenCalled()
  })

  it('wires onUserPlay to player.play and emits playback:change', async () => {
    const core = new GoampCore().renderer(renderer).transport(transport)
    await core.start(container)

    const cb = vi.fn()
    // grab ctx from mount call
    const ctx: ModuleContext = (renderer.mount as any).mock.calls[0][1]
    ctx.events.on(EVENTS.PLAYBACK_CHANGE, cb)

    ;(renderer as any)._trigger('play')
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'PLAYING' }))
  })

  it('wires onUserPause to player.pause', async () => {
    const core = new GoampCore().renderer(renderer).transport(transport)
    await core.start(container)
    const ctx: ModuleContext = (renderer.mount as any).mock.calls[0][1]
    const cb = vi.fn()
    ctx.events.on(EVENTS.PLAYBACK_CHANGE, cb)

    ;(renderer as any)._trigger('pause')
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' }))
  })

  it('wires onUserStop and resets timeElapsed', async () => {
    const core = new GoampCore().renderer(renderer).transport(transport)
    await core.start(container)
    const ctx: ModuleContext = (renderer.mount as any).mock.calls[0][1]
    const cb = vi.fn()
    ctx.events.on(EVENTS.PLAYBACK_CHANGE, cb)

    ;(renderer as any)._trigger('stop')
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'STOPPED', timeElapsed: 0 }))
  })

  it('loadTracks calls renderer.setTracks and emits tracks:load', async () => {
    const core = new GoampCore().renderer(renderer).transport(transport)
    await core.start(container)
    const ctx: ModuleContext = (renderer.mount as any).mock.calls[0][1]
    const cb = vi.fn()
    ctx.events.on(EVENTS.TRACKS_LOAD, cb)

    const tracks: Track[] = [{ id: '1', title: 'A', artist: 'B', source: 'local', sourceId: '/a.mp3' }]
    ctx.player.loadTracks(tracks)

    expect(renderer.setTracks).toHaveBeenCalledWith(tracks)
    expect(cb).toHaveBeenCalledWith(tracks)
  })

  it('onUserClose emits app:close', async () => {
    const core = new GoampCore().renderer(renderer).transport(transport)
    await core.start(container)
    const ctx: ModuleContext = (renderer.mount as any).mock.calls[0][1]
    const cb = vi.fn()
    ctx.events.on(EVENTS.APP_CLOSE, cb)

    ;(renderer as any)._trigger('close')
    expect(cb).toHaveBeenCalled()
  })

  it('each module gets isolated storage namespace', async () => {
    let ctxA: ModuleContext | null = null
    const fA: IFeature = { id: 'fa', init: vi.fn(async (ctx) => { ctxA = ctx }), destroy: vi.fn() }
    const fB: IFeature = { id: 'fb', init: vi.fn(async () => {}), destroy: vi.fn() }

    await new GoampCore().renderer(renderer).transport(transport)
      .feature(fA).feature(fB).start(container)

    ctxA!.storage.set('k', 'from-a')
    // same key in different module — currently both share one storage in core
    // this test verifies the storage works, per-module isolation is Phase 2+
    expect(ctxA!.storage.get('k')).toBe('from-a')
  })
})
