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

  toggleMilkdrop(): void {
    if (this.state?.windows?.genWindows?.milkdrop) {
      // Already initialized — just flip open flag without reinitializing butterchurn
      this.dispatch({ type: 'TOGGLE_WINDOW', windowId: 'milkdrop' })
    } else {
      // First open — must initialize
      this.dispatch({ type: 'ENABLE_MILKDROP', open: true })
    }
  }

  getMilkdropPresets(): string[] {
    return (this.state?.milkdrop?.presets as Array<{ name: string }> | undefined)
      ?.map((p) => p.name) ?? []
  }

  selectMilkdropPreset(index: number): void {
    // TransitionType.IMMEDIATE = 0 — instant switch, no slow blend
    this.dispatch({ type: 'SELECT_PRESET_AT_INDEX', index, transitionType: 0 })
  }

  onMilkdropChange(cb: (open: boolean) => void): () => void {
    let lastOpen = this.isMilkdropOpen()
    return this.store?.subscribe(() => {
      const open = this.isMilkdropOpen()
      if (open !== lastOpen) {
        lastOpen = open
        cb(open)
      }
    }) ?? (() => {})
  }

  onTrackChange(cb: (track: TrackInfo | null) => void): () => void {
    return this.webamp.onTrackDidChange(cb)
  }
}
