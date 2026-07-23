import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import type { Track } from '../../core/types'
import { P2PService } from '../../services/P2PService'
import { EVENTS } from '../../core/events'

export class P2PFeature implements IFeature {
  readonly id = 'p2p'

  private svc: P2PService
  private cleanups: Array<() => void> = []
  private peerCount = 0

  constructor(transport: ITransport) {
    this.svc = new P2PService(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    // Announce track to P2P catalog when playback starts
    this.cleanups.push(
      ctx.events.on<Track>(EVENTS.TRACK_START, async (track) => {
        if (!track.sourceId) return
        try {
          await this.svc.catalogAnnounce(track.sourceId)
        } catch { /* non-critical */ }
      }),
    )

    // Update peer count when the goamp-node emits a profile-synced event
    // (fired via Tauri webview events from node_client.rs)
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail
      if (typeof detail === 'number') this.peerCount = detail
    }
    window.addEventListener('goamp-node:profile-synced', handler)
    this.cleanups.push(() => window.removeEventListener('goamp-node:profile-synced', handler))
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  /** Number of connected P2P peers (updated on profile-synced events). */
  get peers(): number {
    return this.peerCount
  }

  get service(): P2PService {
    return this.svc
  }
}
