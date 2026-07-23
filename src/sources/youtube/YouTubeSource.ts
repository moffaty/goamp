import type { ISource, SearchResult } from '../../core/ISource'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track } from '../../core/types'
import type { ITransport } from '../../services/transport'
import type { YoutubeResult } from '../../youtube/youtube-service'

export class YouTubeSource implements ISource {
  readonly id = 'youtube'
  readonly name = 'YouTube'

  constructor(private readonly transport: ITransport) {}

  async init(ctx: ModuleContext): Promise<void> {
    ctx.ui.registerShortcut('ctrl+y', () => ctx.ui.registerPanel('youtube-search', () => document.createElement('div')))
  }

  destroy(): void {}

  /**
   * Resolve a YouTube track to a playable audio file path.
   *
   * Downloads the audio to a local cache via yt-dlp. Direct streaming of
   * YouTube CDN URLs in the webview is unreliable (YouTube SABR / PO-token
   * changes broke naive <audio> playback), so we download the full file.
   * sourceId may be a bare video id or a page URL.
   */
  async resolve(track: Track): Promise<string | null> {
    if (track.source !== 'youtube') return null
    try {
      const id = track.sourceId
      if (id.includes('youtube.com') || id.includes('youtu.be')) {
        return await this.transport.call<string>('extract_audio_url', { url: id })
      }
      return await this.transport.call<string>('extract_audio', { videoId: id })
    } catch {
      return null
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const results = await this.transport.call<YoutubeResult[]>('search_youtube', {
      query,
      limit: null,
      source: null,
    })
    return results.map((r) => ({
      track: youtubeResultToTrack(r),
      previewUrl: r.thumbnail,
    }))
  }

  /**
   * YouTube's auto-generated "Mix" (radio) for a video — an endless list of
   * related tracks curated by YouTube itself. Requires NO API key: YouTube
   * builds a playlist with id `RD<videoId>` for every video.
   */
  async relatedMix(videoId: string): Promise<Track[]> {
    const url = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`
    const results = await this.transport.call<YoutubeResult[]>('youtube_get_playlist', { url })
    return results.map(youtubeResultToTrack)
  }
}

function youtubeResultToTrack(r: YoutubeResult): Track {
  return {
    id: '',
    title: r.title,
    artist: r.channel,
    duration: r.duration,
    cover: r.thumbnail,
    source: 'youtube',
    sourceId: r.id,
  }
}
