import type Webamp from 'webamp'
import type { IRenderer } from '../../core/IRenderer'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track, PlaybackState } from '../../core/types'
import type { TrackInfo } from '../../player/PlayerStore'
import { PlayerStore } from '../../player/PlayerStore'
import { PlayerEvents } from '../../player/PlayerEvents'
import { EVENTS } from '../../core/events'

export class WebampRenderer implements IRenderer {
  readonly id = 'webamp'

  private ps: PlayerStore | null = null
  private pe: PlayerEvents | null = null
  private cleanups: Array<() => void> = []

  private _onPlay: (() => void) | null = null
  private _onPause: (() => void) | null = null
  private _onStop: (() => void) | null = null
  private _onClose: (() => void) | null = null

  constructor(readonly webamp: Webamp) {}

  async mount(container: HTMLElement, ctx: ModuleContext): Promise<void> {
    this.ps = new PlayerStore(this.webamp)
    this.pe = new PlayerEvents(this.ps)

    await (this.webamp as any).renderWhenReady(container)

    // Emit track:start / track:end events into the core bus
    let activeTrack: Track | null = null
    this.cleanups.push(
      this.pe.onTrackChange((info) => {
        if (activeTrack) {
          ctx.events.emit(EVENTS.TRACK_END, {
            track: activeTrack,
            timeElapsed: this.ps!.getTimeElapsed(),
          })
        }
        activeTrack = info ? webampInfoToTrack(info) : null
        if (activeTrack) ctx.events.emit(EVENTS.TRACK_START, activeTrack)
      }),
    )

    // Observe Webamp Redux status → fire user-intent callbacks
    this.cleanups.push(
      this.ps.onStatusChange((status) => {
        if (status === 'PLAYING') this._onPlay?.()
        else if (status === 'PAUSED') this._onPause?.()
        else if (status === 'STOPPED') this._onStop?.()
      }),
    )

    // Close handler
    this.webamp.onWillClose(() => this._onClose?.())
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  // ── Core → Renderer ───────────────────────────────────────────────────────

  setTracks(tracks: Track[]): void {
    ;(this.webamp as any).setTracksToPlay(
      tracks.map((t) => ({
        url: t.streamUrl ?? '',
        duration: t.duration,
        metaData: { artist: t.artist, title: t.title },
      })),
    )
  }

  setPlaybackState(state: PlaybackState): void {
    if (!this.ps) return
    if (state.status === 'PLAYING') this.ps.dispatch({ type: 'PLAY' })
    else if (state.status === 'PAUSED') this.ps.dispatch({ type: 'PAUSE' })
    else if (state.status === 'STOPPED') this.ps.dispatch({ type: 'STOP' })
  }

  // ── Renderer → Core (user intent) ────────────────────────────────────────

  onUserPlay(cb: () => void): void { this._onPlay = cb }
  onUserPause(cb: () => void): void { this._onPause = cb }
  onUserStop(cb: () => void): void { this._onStop = cb }
  onUserNext(_cb: () => void): void {}
  onUserPrev(_cb: () => void): void {}
  onUserSeek(_cb: (seconds: number) => void): void {}
  onUserAddTracks(_cb: (tracks: Track[]) => void): void {}
  onUserClose(cb: () => void): void { this._onClose = cb }

  // ── Accessors for features that still need PlayerStore/Events ────────────

  get playerStore(): PlayerStore {
    if (!this.ps) throw new Error('WebampRenderer: not mounted')
    return this.ps
  }

  get playerEvents(): PlayerEvents {
    if (!this.pe) throw new Error('WebampRenderer: not mounted')
    return this.pe
  }
}

function webampInfoToTrack(info: TrackInfo): Track {
  const url = info.url ?? ''
  const source = url.startsWith('http')
    ? url.includes('youtube') || url.includes('audio_cache') ? 'youtube' : 'radio'
    : 'local'
  return {
    id: '',
    title: info.metaData?.title || url.split('/').pop() || 'Unknown',
    artist: info.metaData?.artist || 'Unknown',
    duration: info.duration,
    source,
    sourceId: url,
    streamUrl: url,
  }
}
