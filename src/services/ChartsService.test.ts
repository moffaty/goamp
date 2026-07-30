import { describe, it, expect, beforeEach } from 'vitest'
import { ChartsService } from './ChartsService'
import { MockTransport } from './transport'

describe('ChartsService', () => {
  let transport: MockTransport
  let svc: ChartsService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new ChartsService(transport)
  })

  it('getTopTracks calls transport with period and limit', async () => {
    transport.setResponse('get_top_tracks_cmd', [])
    await svc.getTopTracks('week', 20)
    expect(transport.lastCall?.command).toBe('get_top_tracks_cmd')
    expect(transport.lastCall?.args).toEqual({ period: 'week', limit: 20 })
  })

  it('getTopTracks defaults limit to 50', async () => {
    transport.setResponse('get_top_tracks_cmd', [])
    await svc.getTopTracks('month')
    expect(transport.lastCall?.args).toEqual({ period: 'month', limit: 50 })
  })

  it('getTopTracks returns the transport response', async () => {
    const rows = [{ canonical_id: 'x', artist: 'A', title: 'T', play_count: 5 }]
    transport.setResponse('get_top_tracks_cmd', rows)
    expect(await svc.getTopTracks('all')).toEqual(rows)
  })

  it('getCommunityCharts calls the community command with a default limit of 50', async () => {
    transport.setResponse('get_community_charts_cmd', [])
    await svc.getCommunityCharts()
    expect(transport.lastCall?.command).toBe('get_community_charts_cmd')
    expect(transport.lastCall?.args).toEqual({ limit: 50 })
  })
})
