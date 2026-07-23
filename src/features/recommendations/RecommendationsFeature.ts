import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import type { Track } from '../../core/types'
import { RecommendationService } from '../../services/RecommendationService'
import { HistoryService } from '../../services/HistoryService'
import { SettingsService } from '../../services/SettingsService'
import { EVENTS } from '../../core/events'

export class RecommendationsFeature implements IFeature {
  readonly id = 'recommendations'

  private recs: RecommendationService
  private history: HistoryService
  private settings: SettingsService
  private cleanups: Array<() => void> = []

  constructor(transport: ITransport) {
    this.recs = new RecommendationService(transport)
    this.history = new HistoryService(transport)
    this.settings = new SettingsService(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    await this.settings.refreshFlagCache().catch(() => {})
    if (!this.settings.isEnabled('recommendations')) return

    // Sync taste profile when a track ends
    this.cleanups.push(
      ctx.events.on<{ track: Track }>(EVENTS.TRACK_END, () => {
        this.recs.syncProfile().catch(() => {})
      }),
    )
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  get service(): RecommendationService {
    return this.recs
  }

  get historyService(): HistoryService {
    return this.history
  }
}
