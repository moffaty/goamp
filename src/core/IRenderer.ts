import type { Track, PlaybackState } from './types'
import type { ModuleContext } from './ModuleContext'

export interface IRenderer {
  readonly id: string

  mount(container: HTMLElement, ctx: ModuleContext): Promise<void>
  destroy(): void

  setTracks(tracks: Track[]): void
  setPlaybackState(state: PlaybackState): void

  onUserPlay(cb: () => void): void
  onUserPause(cb: () => void): void
  onUserStop(cb: () => void): void
  onUserNext(cb: () => void): void
  onUserPrev(cb: () => void): void
  onUserSeek(cb: (seconds: number) => void): void
  onUserAddTracks(cb: (tracks: Track[]) => void): void
  onUserClose(cb: () => void): void
}
