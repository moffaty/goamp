import type { IRenderer } from './IRenderer'
import type { ISource } from './ISource'
import type { IFeature } from './IFeature'
import type { ModuleContext, IPlayer, IUIRegistry } from './ModuleContext'
import type { Track, PlaybackState } from './types'
import type { ITransport } from '../services/transport'
import { EventBus } from './EventBus'
import { LocalKVStorage } from './KVStorage'
import { UIRegistry } from './UIRegistry'
import { EVENTS } from './events'

export { EVENTS }

/** Custom event fired when a source/feature init throws. main.ts subscribes
 *  to surface these via the error overlay (no devtools in prod). Using a
 *  CustomEvent (not ErrorEvent) avoids triggering jsdom/browser unhandled-
 *  error machinery — we WANT the failure to be reported but NOT to crash. */
export const MODULE_ERROR_EVENT = 'goamp:module-error'

export interface ModuleErrorDetail {
  module: string
  error: unknown
}

function reportModuleError(label: string, err: unknown): void {
  console.error(`[GoampCore] ${label} init failed:`, err)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ModuleErrorDetail>(MODULE_ERROR_EVENT, {
      detail: { module: label, error: err },
    }))
  }
}

export class GoampCore {
  private _renderer: IRenderer | null = null
  private _sources: ISource[] = []
  private _features: IFeature[] = []
  private _transport: ITransport | null = null
  private _bus = new EventBus()

  renderer(r: IRenderer): this { this._renderer = r; return this }
  source(s: ISource): this { this._sources.push(s); return this }
  feature(f: IFeature): this { this._features.push(f); return this }
  transport(t: ITransport): this { this._transport = t; return this }

  async start(container: HTMLElement): Promise<void> {
    if (!this._renderer) throw new Error('GoampCore: no renderer registered')
    if (!this._transport) throw new Error('GoampCore: no transport registered')

    const ctx = this.buildContext()

    // Renderer must succeed — without it there's no UI.
    await this._renderer.mount(container, ctx)
    this.wireRenderer(ctx)

    // Sources and features run in isolation: one failure must not kill the UI
    // or the rest of the modules. Errors are logged and surfaced as window
    // 'error' events so the production error overlay can show them.
    for (const s of this._sources) {
      try {
        await s.init(ctx)
      } catch (e) {
        reportModuleError(`source "${s.id}"`, e)
      }
    }
    for (const f of this._features) {
      try {
        await f.init(ctx)
      } catch (e) {
        reportModuleError(`feature "${f.id}"`, e)
      }
    }
  }

  async destroy(): Promise<void> {
    this._bus.emit(EVENTS.APP_CLOSE, undefined)
    for (const f of this._features) f.destroy()
    for (const s of this._sources) s.destroy()
    this._renderer?.destroy()
  }

  private buildContext(): ModuleContext {
    const player = this.buildPlayer()
    const ui = this.buildUI()

    return {
      player,
      events: this._bus,
      ui,
      storage: new LocalKVStorage('goamp'),
      transport: this._transport!,
    }
  }

  private buildPlayer(): IPlayer {
    const renderer = this._renderer!
    const bus = this._bus
    let currentState: PlaybackState = { status: 'STOPPED', track: null, timeElapsed: 0, duration: 0 }

    const notify = (state: PlaybackState) => {
      currentState = state
      renderer.setPlaybackState(state)
      bus.emit(EVENTS.PLAYBACK_CHANGE, state)
    }

    return {
      play: () => notify({ ...currentState, status: 'PLAYING' }),
      pause: () => notify({ ...currentState, status: 'PAUSED' }),
      stop: () => notify({ ...currentState, status: 'STOPPED', timeElapsed: 0 }),
      next: () => bus.emit('player:cmd', 'next'),
      prev: () => bus.emit('player:cmd', 'prev'),
      seek: (seconds) => bus.emit('player:cmd:seek', seconds),
      loadTracks: (tracks: Track[]) => {
        renderer.setTracks(tracks)
        bus.emit(EVENTS.TRACKS_LOAD, tracks)
      },
      getState: () => currentState,
    }
  }

  private buildUI(): IUIRegistry {
    return new UIRegistry()
  }

  private wireRenderer(ctx: ModuleContext): void {
    const r = this._renderer!
    const { player, events } = ctx

    r.onUserPlay(() => player.play())
    r.onUserPause(() => player.pause())
    r.onUserStop(() => player.stop())
    r.onUserNext(() => player.next())
    r.onUserPrev(() => player.prev())
    r.onUserSeek((s) => player.seek(s))
    r.onUserAddTracks((tracks) => player.loadTracks(tracks))
    r.onUserClose(() => events.emit(EVENTS.APP_CLOSE, undefined))
  }
}
