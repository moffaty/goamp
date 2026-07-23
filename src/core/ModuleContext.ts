import type { Track, PlaybackState } from './types'
import type { IEventBus } from './EventBus'
import type { IKVStorage } from './KVStorage'
import type { ITransport } from '../services/transport'

export interface IPlayer {
  play(): void
  pause(): void
  stop(): void
  next(): void
  prev(): void
  seek(seconds: number): void
  loadTracks(tracks: Track[]): void
  getState(): PlaybackState
}

export interface IUIRegistry {
  registerPanel(id: string, render: () => HTMLElement): void
  registerShortcut(keys: string, handler: () => void): void
  registerMenuItem(label: string, handler: () => void): void
  /** Open/close a previously registered panel by id. No-ops if no host is wired. */
  togglePanel(id: string): void
}

export interface ModuleContext {
  player: IPlayer
  events: IEventBus
  ui: IUIRegistry
  storage: IKVStorage
  transport: ITransport
}
