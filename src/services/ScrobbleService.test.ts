import { describe, it, expect, beforeEach } from 'vitest'
import { ScrobbleService } from './ScrobbleService'
import { MockTransport } from './transport'

describe('ScrobbleService', () => {
  let transport: MockTransport
  let svc: ScrobbleService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new ScrobbleService(transport)
  })

  it('lastfmNowPlaying sends correct command', async () => {
    transport.setResponse('lastfm_now_playing', undefined)
    await svc.lastfmNowPlaying('Artist', 'Title', 200)
    expect(transport.lastCall).toEqual({
      command: 'lastfm_now_playing',
      args: { artist: 'Artist', title: 'Title', duration: 200 },
    })
  })

  it('lastfmNowPlaying sends null duration when omitted', async () => {
    transport.setResponse('lastfm_now_playing', undefined)
    await svc.lastfmNowPlaying('A', 'B')
    expect(transport.lastCall.args!.duration).toBeNull()
  })

  it('lastfmScrobble sends correct command', async () => {
    transport.setResponse('lastfm_scrobble', undefined)
    await svc.lastfmScrobble('Artist', 'Title', 1000, 200)
    expect(transport.lastCall).toEqual({
      command: 'lastfm_scrobble',
      args: { artist: 'Artist', title: 'Title', timestamp: 1000, duration: 200 },
    })
  })

  it('lastfmGetStatus returns status', async () => {
    transport.setResponse('lastfm_get_status', 'testuser')
    const result = await svc.lastfmGetStatus()
    expect(result).toBe('testuser')
  })

  it('flushQueue calls scrobble_flush_queue', async () => {
    transport.setResponse('scrobble_flush_queue', 3)
    const result = await svc.flushQueue()
    expect(result).toBe(3)
    expect(transport.lastCall.command).toBe('scrobble_flush_queue')
  })

  it('listenbrainzNowPlaying sends correct command', async () => {
    transport.setResponse('listenbrainz_now_playing', undefined)
    await svc.listenbrainzNowPlaying('Artist', 'Title')
    expect(transport.lastCall).toEqual({
      command: 'listenbrainz_now_playing',
      args: { artist: 'Artist', title: 'Title' },
    })
  })
})
