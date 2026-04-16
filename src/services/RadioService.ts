import type { ITransport } from './transport'
import type { IRadioService, RadioStation, RadioTag, RadioNowPlaying, CachedSegment } from './interfaces'

export class RadioService implements IRadioService {
  constructor(private t: ITransport) {}

  search(query: string, tag?: string, country?: string, limit?: number) {
    return this.t.call<RadioStation[]>('radio_search', { query, tag: tag ?? null, country: country ?? null, limit: limit ?? null })
  }
  topStations(limit?: number) { return this.t.call<RadioStation[]>('radio_top_stations', { limit: limit ?? null }) }
  byTag(tag: string, limit?: number) { return this.t.call<RadioStation[]>('radio_by_tag', { tag, limit: limit ?? null }) }
  tags() { return this.t.call<RadioTag[]>('radio_tags') }
  addFavorite(station: RadioStation) { return this.t.call<void>('radio_add_favorite', { stationJson: JSON.stringify(station) }) }
  removeFavorite(stationuuid: string) { return this.t.call<void>('radio_remove_favorite', { stationuuid }) }
  listFavorites() { return this.t.call<RadioStation[]>('radio_list_favorites') }
  addCustom(name: string, url: string, tags?: string) { return this.t.call<void>('radio_add_custom', { name, url, tags: tags ?? null }) }
  removeCustom(id: string) { return this.t.call<void>('radio_remove_custom', { id }) }
  listCustom() { return this.t.call<RadioStation[]>('radio_list_custom') }
  play(station: RadioStation) { return this.t.call<string>('radio_play', { stationJson: JSON.stringify(station) }) }
  stop() { return this.t.call<void>('radio_stop') }
  nowPlaying() { return this.t.call<RadioNowPlaying | null>('radio_now_playing') }
  listCached() { return this.t.call<CachedSegment[]>('radio_list_cached') }
  saveSegment(index: number, title?: string) { return this.t.call<string>('radio_save_segment', { index, title: title ?? null }) }
  saveLastSecs(secs: number, title?: string) { return this.t.call<string>('radio_save_last_secs', { secs, title: title ?? null }) }
}
