import type Webamp from 'webamp'

export type PlayerStatus = 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface TrackInfo {
  url: string
  duration?: number
  metaData?: { artist?: string; title?: string }
}

export interface RawTrack {
  id: string
  url: string
  title?: string
  artist?: string
  duration?: number
  defaultName?: string
}

export interface PlayerAction {
  type: string
  [key: string]: unknown
}

export class PlayerStore {
  constructor(private webamp: Webamp) {}

  private get store(): any {
    return (this.webamp as any).store
  }

  private get state(): any {
    return this.store?.getState() ?? {}
  }

  getStatus(): PlayerStatus {
    return this.state?.media?.status ?? 'STOPPED'
  }

  getTimeElapsed(): number {
    return this.state?.media?.timeElapsed ?? 0
  }

  getTracks(): RawTrack[] {
    const tracks = this.state?.playlist?.tracks ?? {}
    const order: string[] = this.state?.playlist?.trackOrder ?? []
    return order
      .filter((id) => tracks[id] != null)
      .map((id: string) => ({ id, ...tracks[id] }))
  }

  dispatch(action: PlayerAction): void {
    this.store?.dispatch(action)
  }

  isMilkdropOpen(): boolean {
    return this.state?.windows?.genWindows?.milkdrop?.open ?? false
  }

  onTrackChange(cb: (track: TrackInfo | null) => void): () => void {
    return this.webamp.onTrackDidChange(cb)
  }
}
