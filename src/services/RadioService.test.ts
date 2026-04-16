import { describe, it, expect, beforeEach } from 'vitest'
import { RadioService } from './RadioService'
import { MockTransport } from './transport'
import type { RadioStation } from './interfaces'

const fakeStation: RadioStation = {
  stationuuid: 'uuid-1', name: 'Test FM', url: 'http://stream', url_resolved: 'http://stream',
  homepage: '', favicon: '', tags: 'jazz', country: 'RU', countrycode: 'RU',
  language: 'ru', codec: 'MP3', bitrate: 128, votes: 100, clickcount: 50,
}

describe('RadioService', () => {
  let transport: MockTransport
  let svc: RadioService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new RadioService(transport)
  })

  it('search calls radio_search', async () => {
    transport.setResponse('radio_search', [fakeStation])
    await svc.search('jazz', 'jazz', 'RU', 10)
    expect(transport.lastCall).toEqual({
      command: 'radio_search',
      args: { query: 'jazz', tag: 'jazz', country: 'RU', limit: 10 },
    })
  })

  it('search passes null for optional args when omitted', async () => {
    transport.setResponse('radio_search', [])
    await svc.search('rock')
    expect(transport.lastCall.args).toEqual({ query: 'rock', tag: null, country: null, limit: null })
  })

  it('play calls radio_play with JSON station', async () => {
    transport.setResponse('radio_play', 'http://stream')
    await svc.play(fakeStation)
    expect(transport.lastCall.command).toBe('radio_play')
    expect(transport.lastCall.args!.stationJson).toBe(JSON.stringify(fakeStation))
  })

  it('addFavorite calls radio_add_favorite with JSON station', async () => {
    transport.setResponse('radio_add_favorite', undefined)
    await svc.addFavorite(fakeStation)
    expect(transport.lastCall.args!.stationJson).toBe(JSON.stringify(fakeStation))
  })
})
