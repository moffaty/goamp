import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import type { Track, PlaybackState } from '../../core/types'
import { ScrobbleService } from '../../services/ScrobbleService'
import { SettingsService } from '../../services/SettingsService'
import { EVENTS } from '../../core/events'

export class ScrobbleFeature implements IFeature {
  readonly id = 'scrobble'

  private scrobble: ScrobbleService
  private settings: SettingsService
  private cleanups: Array<() => void> = []

  private timer: ReturnType<typeof setInterval> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private trackStart = 0
  private trackDuration = 0
  private trackArtist = ''
  private trackTitle = ''
  private scrobbled = false
  private isPlaying = false

  constructor(transport: ITransport) {
    this.scrobble = new ScrobbleService(transport)
    this.settings = new SettingsService(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    await this.settings.refreshFlagCache().catch(() => {})

    this.flushTimer = setInterval(() => {
      this.scrobble.flushQueue().catch(() => {})
    }, 30_000)

    this.cleanups.push(
      ctx.events.on<Track>(EVENTS.TRACK_START, (track) => {
        this.onTrackStart(track)
      }),
    )

    this.cleanups.push(
      ctx.events.on<PlaybackState>(EVENTS.PLAYBACK_CHANGE, (state) => {
        this.isPlaying = state.status === 'PLAYING'
      }),
    )

    this.cleanups.push(
      ctx.events.on(EVENTS.APP_CLOSE, () => this.clearTimer()),
    )
  }

  destroy(): void {
    this.clearTimer()
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  get service(): ScrobbleService {
    return this.scrobble
  }

  private async onTrackStart(track: Track): Promise<void> {
    this.clearTimer()
    this.scrobbled = false
    this.trackStart = Math.floor(Date.now() / 1000)
    this.trackArtist = track.artist
    this.trackTitle = track.title
    this.trackDuration = track.duration ?? 0

    if (!this.trackArtist && !this.trackTitle) return
    if (!this.settings.isEnabled('auto_scrobble')) return

    const lastfmOn = localStorage.getItem('goamp_lastfm_enabled') === '1' && this.settings.isEnabled('lastfm_scrobble')
    const lbOn = localStorage.getItem('goamp_lb_enabled') === '1' && this.settings.isEnabled('listenbrainz_scrobble')
    if (!lastfmOn && !lbOn) return

    const [hasLastfm, hasLb] = await Promise.all([
      lastfmOn ? this.scrobble.lastfmGetStatus().then(Boolean).catch(() => false) : Promise.resolve(false),
      lbOn ? this.scrobble.listenbrainzGetStatus().then(Boolean).catch(() => false) : Promise.resolve(false),
    ])
    if (!hasLastfm && !hasLb) return

    const dur = this.trackDuration > 0 ? Math.floor(this.trackDuration) : undefined
    if (hasLastfm) this.scrobble.lastfmNowPlaying(this.trackArtist, this.trackTitle, dur).catch(() => {})
    if (hasLb) this.scrobble.listenbrainzNowPlaying(this.trackArtist, this.trackTitle).catch(() => {})

    this.timer = setInterval(() => {
      if (this.scrobbled || !this.isPlaying) return
      const elapsed = Math.floor(Date.now() / 1000) - this.trackStart
      const threshold = Math.min(this.trackDuration > 0 ? this.trackDuration / 2 : Infinity, 240)
      if (elapsed >= threshold) {
        this.scrobbled = true
        this.clearTimer()
        const sd = this.trackDuration > 0 ? Math.floor(this.trackDuration) : undefined
        if (hasLastfm) this.scrobble.lastfmScrobble(this.trackArtist, this.trackTitle, this.trackStart, sd).catch(() => {})
        if (hasLb) this.scrobble.listenbrainzScrobble(this.trackArtist, this.trackTitle, this.trackStart, sd).catch(() => {})
      }
    }, 5_000)
  }

  private clearTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }
}
