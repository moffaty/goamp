import { describe, it, expect, beforeEach } from 'vitest'
import { RecommendationService } from './RecommendationService'
import { MockTransport } from './transport'

describe('RecommendationService', () => {
  let transport: MockTransport
  let svc: RecommendationService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new RecommendationService(transport)
  })

  it('getRecommendations maps tuples to Recommendation objects', async () => {
    transport.setResponse('get_hybrid_recommendations', [
      ['cid1', 0.9, 'local', 'Artist', 'Title'],
    ])
    const result = await svc.getRecommendations(10)
    expect(result).toEqual([{ canonicalId: 'cid1', score: 0.9, source: 'local', artist: 'Artist', title: 'Title' }])
    expect(transport.lastCall).toEqual({ command: 'get_hybrid_recommendations', args: { limit: 10 } })
  })

  it('getRecommendations passes null when limit omitted', async () => {
    transport.setResponse('get_hybrid_recommendations', [])
    await svc.getRecommendations()
    expect(transport.lastCall.args).toEqual({ limit: null })
  })

  it('listMoodChannels calls list_mood_channels', async () => {
    transport.setResponse('list_mood_channels', [])
    await svc.listMoodChannels()
    expect(transport.lastCall.command).toBe('list_mood_channels')
  })

  it('syncProfile returns count', async () => {
    transport.setResponse('sync_profile', 5)
    const n = await svc.syncProfile()
    expect(n).toBe(5)
  })
})
