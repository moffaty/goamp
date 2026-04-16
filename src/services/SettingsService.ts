import type { ITransport } from './transport'
import type { ISettingsService, FeatureFlag } from './interfaces'
import type { TrackMeta } from '../lib/tauri-ipc'

export class SettingsService implements ISettingsService {
  private cache = new Map<string, boolean>()

  constructor(private t: ITransport) {}

  listFlags() { return this.t.call<FeatureFlag[]>('feature_flags_list') }
  setFlag(key: string, enabled: boolean) { return this.t.call<void>('feature_flags_set', { key, enabled }) }
  getFlag(key: string) { return this.t.call<boolean>('feature_flag_get', { key }) }

  async refreshFlagCache(): Promise<void> {
    const flags = await this.listFlags()
    this.cache.clear()
    for (const f of flags) this.cache.set(f.key, f.enabled)
  }

  isEnabled(key: string): boolean {
    return this.cache.get(key) ?? true
  }

  youtubeSetCookies(path: string) { return this.t.call<void>('youtube_set_cookies', { path }) }
  youtubeGetCookies() { return this.t.call<string | null>('youtube_get_cookies') }
  youtubeClearCookies() { return this.t.call<void>('youtube_clear_cookies') }
  youtubeGetPlaylist(url: string) { return this.t.call<any[]>('youtube_get_playlist', { url }) }
  scanDirectory(path: string) { return this.t.call<TrackMeta[]>('scan_directory', { path }) }
  readMetadata(path: string) { return this.t.call<TrackMeta>('read_metadata', { path }) }
}
