import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import type { Track } from '../../core/types'
import { HistoryService } from '../../services/HistoryService'
import { EVENTS } from '../../core/events'

export class HistoryFeature implements IFeature {
  readonly id = 'history'

  private svc: HistoryService
  private cleanups: Array<() => void> = []

  private trackStartedAt = 0

  constructor(transport: ITransport) {
    this.svc = new HistoryService(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    this.cleanups.push(
      ctx.events.on<Track>(EVENTS.TRACK_START, () => {
        this.trackStartedAt = Math.floor(Date.now() / 1000)
      }),
    )

    this.cleanups.push(
      ctx.events.on<{ track: Track; timeElapsed: number }>(EVENTS.TRACK_END, async ({ track, timeElapsed }) => {
        if (!track.sourceId) return
        try {
          const canonicalId = await this.svc.resolveTrackId(
            track.source,
            track.sourceId,
            track.artist,
            track.title,
            track.duration ?? 0,
          )
          const duration = track.duration ?? 0
          const listened = Math.floor(timeElapsed)
          const completed = duration > 0 && listened >= duration * 0.8
          const skippedEarly = duration > 0 && listened < 10
          await this.svc.recordListen(
            canonicalId,
            track.source,
            this.trackStartedAt,
            duration,
            listened,
            completed,
            skippedEarly,
          )
        } catch { /* non-critical */ }
      }),
    )
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  get service(): HistoryService {
    return this.svc
  }
}
