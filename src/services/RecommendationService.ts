import type { ITransport } from './transport'
import type { IRecommendationService, Recommendation, MoodChannel } from './interfaces'

export class RecommendationService implements IRecommendationService {
  constructor(private t: ITransport) {}

  syncProfile() { return this.t.call<number>('sync_profile') }

  async getRecommendations(limit?: number): Promise<Recommendation[]> {
    const recs = await this.t.call<[string, number, string, string, string][]>(
      'get_hybrid_recommendations', { limit: limit ?? null }
    )
    return recs.map(([canonicalId, score, source, artist, title]) => ({ canonicalId, score, source, artist, title }))
  }

  getColdstart(artist: string, title: string, limit?: number) {
    return this.t.call<[string, string, number][]>('get_coldstart_recommendations', { artist, title, limit: limit ?? null })
  }
  listMoodChannels() { return this.t.call<MoodChannel[]>('list_mood_channels') }
  createMoodChannel(name: string, description: string) { return this.t.call<MoodChannel>('create_mood_channel', { name, description }) }
  addSeedTrack(channelId: string, canonicalId: string) { return this.t.call<void>('add_seed_track', { channelId, canonicalId }) }
  deleteMoodChannel(channelId: string) { return this.t.call<void>('delete_mood_channel', { channelId }) }
}
