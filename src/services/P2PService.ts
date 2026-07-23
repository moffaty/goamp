import type { ITransport } from './transport'

export interface NodeHealth {
  status: string
  peer_count: number
  uptime_secs: number
  version: string
}

export interface PeerInfo {
  id: string
  addrs: string[]
}

export interface CatalogTrack {
  id: string
  title: string
  artist: string
  source: string
  duration: number
}

export class P2PService {
  constructor(private readonly t: ITransport) {}

  health(): Promise<NodeHealth> {
    return this.t.call<NodeHealth>('p2p_health')
  }

  peers(): Promise<PeerInfo[]> {
    return this.t.call<PeerInfo[]>('p2p_peers')
  }

  catalogSearch(q: string, genres?: string[], limit?: number): Promise<CatalogTrack[]> {
    return this.t.call<CatalogTrack[]>('p2p_catalog_search', { q, genres: genres ?? null, limit: limit ?? null })
  }

  catalogAnnounce(trackId: string): Promise<void> {
    return this.t.call<void>('p2p_catalog_announce', { trackId })
  }
}
