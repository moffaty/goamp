import type { Track, PlaybackState } from './types'

export const EVENTS = {
  PLAYBACK_CHANGE: 'playback:change',
  TRACK_START: 'track:start',
  TRACK_END: 'track:end',
  TRACKS_LOAD: 'tracks:load',
  APP_CLOSE: 'app:close',
  PEERS_UPDATED: 'peers:updated',
} as const

export type EventMap = {
  [EVENTS.PLAYBACK_CHANGE]: PlaybackState
  [EVENTS.TRACK_START]: Track
  [EVENTS.TRACK_END]: { track: Track; timeElapsed: number }
  [EVENTS.TRACKS_LOAD]: Track[]
  [EVENTS.APP_CLOSE]: undefined
  [EVENTS.PEERS_UPDATED]: number
}
