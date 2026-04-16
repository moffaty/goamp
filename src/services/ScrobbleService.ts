import type { ITransport } from './transport'
import type { IScrobbleService, ScrobbleStatus } from './interfaces'

export class ScrobbleService implements IScrobbleService {
  constructor(private t: ITransport) {}

  lastfmSaveSettings(apiKey: string, secret: string) {
    return this.t.call<void>('lastfm_save_settings', { apiKey, secret })
  }
  lastfmGetAuthUrl() { return this.t.call<string>('lastfm_get_auth_url') }
  lastfmAuth(token: string) { return this.t.call<{ name: string; key: string }>('lastfm_auth', { token }) }
  lastfmGetStatus() { return this.t.call<string | null>('lastfm_get_status') }
  lastfmNowPlaying(artist: string, title: string, duration?: number) {
    return this.t.call<void>('lastfm_now_playing', { artist, title, duration: duration ?? null })
  }
  lastfmScrobble(artist: string, title: string, timestamp: number, duration?: number) {
    return this.t.call<void>('lastfm_scrobble', { artist, title, timestamp, duration: duration ?? null })
  }
  listenbrainzSaveToken(token: string) { return this.t.call<string>('listenbrainz_save_token', { token }) }
  listenbrainzGetStatus() { return this.t.call<string | null>('listenbrainz_get_status') }
  listenbrainzLogout() { return this.t.call<void>('listenbrainz_logout') }
  listenbrainzNowPlaying(artist: string, title: string) {
    return this.t.call<void>('listenbrainz_now_playing', { artist, title })
  }
  listenbrainzScrobble(artist: string, title: string, timestamp: number, duration?: number) {
    return this.t.call<void>('listenbrainz_scrobble', { artist, title, timestamp, duration: duration ?? null })
  }
  getStatus() { return this.t.call<ScrobbleStatus>('scrobble_get_status') }
  flushQueue() { return this.t.call<number>('scrobble_flush_queue') }
}
