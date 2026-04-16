import type { ITransport } from './transport'
import type { IHistoryService, ListenStats, Survey } from './interfaces'

export class HistoryService implements IHistoryService {
  constructor(private t: ITransport) {}

  resolveTrackId(source: string, sourceId: string, artist: string, title: string, duration: number) {
    return this.t.call<string>('resolve_track_id', { source, sourceId, artist, title, duration })
  }
  recordListen(canonicalId: string, source: string, startedAt: number, durationSecs: number, listenedSecs: number, completed: boolean, skippedEarly: boolean) {
    return this.t.call<void>('record_track_listen', { canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly })
  }
  setLike(canonicalId: string, liked: boolean) { return this.t.call<void>('set_track_like', { canonicalId, liked }) }
  removeLike(canonicalId: string) { return this.t.call<void>('remove_track_like', { canonicalId }) }
  getStats(canonicalId: string) { return this.t.call<ListenStats>('get_track_stats', { canonicalId }) }
  getLikedTracks() { return this.t.call<string[]>('get_liked_tracks') }
  surveyGetPending() { return this.t.call<Survey | null>('survey_get_pending') }
  surveyRespond(surveyId: number, response: string) { return this.t.call<void>('survey_respond', { surveyId, response }) }
  surveySkip(surveyId: number) { return this.t.call<void>('survey_skip', { surveyId }) }
  surveyMarkShown(surveyId: number) { return this.t.call<void>('survey_mark_shown', { surveyId }) }
}
