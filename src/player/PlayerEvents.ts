import type { PlayerStore, TrackInfo } from './PlayerStore'

type TrackChangeListener = (track: TrackInfo | null) => void

export class PlayerEvents {
  private listeners: TrackChangeListener[] = []

  constructor(store: PlayerStore) {
    store.onTrackChange((track) => {
      for (const cb of this.listeners) cb(track)
    })
  }

  onTrackChange(cb: TrackChangeListener): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }
}
