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

    // Peer count flows through the module bus. WebampUIFeature bridges the Tauri
    // `goamp-node:profile-synced` event onto ctx.events, keeping this feature Tauri-free.
    this.cleanups.push(
      ctx.events.on<number>(EVENTS.PEERS_UPDATED, (count) => {
        this.peerCount = count
      }),
    )

    // Register the peer-list panel + a menu item to reach it.
    ctx.ui.registerPanel('p2p-peers', () => this.renderPeerPanel())
    ctx.ui.registerMenuItem('Peers', () => ctx.ui.togglePanel('p2p-peers'), 'peers')
  }

  /** Renders the peer-list panel: count header + async-loaded peer rows. */
  private renderPeerPanel(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'goamp-p2p-panel'
    el.style.cssText =
      'background:#1e1e1e;color:#00ff00;font-family:monospace;font-size:11px;padding:8px;border:2px inset #444;'

    const header = document.createElement('div')
    header.className = 'goamp-p2p-header'
    header.textContent = `Connected Peers: ${this.peerCount}`
    header.style.cssText = 'font-weight:bold;margin-bottom:6px;'
    el.appendChild(header)

    const list = document.createElement('ul')
    list.className = 'goamp-p2p-list'
    list.style.cssText = 'list-style:none;margin:0;padding:0;'
    list.textContent = 'Loading peers…'
    el.appendChild(list)

    this.svc.peers()
      .then((peers) => {
        list.textContent = ''
        if (peers.length === 0) {
          list.textContent = 'No peers connected'
          return
        }
        for (const p of peers) {
          const li = document.createElement('li')
          const shortId = p.id.length > 16 ? `${p.id.slice(0, 8)}…${p.id.slice(-4)}` : p.id
          li.textContent = `${shortId}  ${p.addrs[0] ?? ''}`.trim()
          list.appendChild(li)
        }
      })
      .catch(() => { list.textContent = 'Could not load peer list' })

    return el
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
