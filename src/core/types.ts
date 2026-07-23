export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  cover?: string
  source: string
  sourceId: string
  streamUrl?: string
}

export type PlaybackStatus = 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface PlaybackState {
  status: PlaybackStatus
  track: Track | null
  timeElapsed: number
  duration: number
}
