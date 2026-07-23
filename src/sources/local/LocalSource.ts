import { convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { ISource, SearchResult } from '../../core/ISource'
import type { ModuleContext } from '../../core/ModuleContext'
import type { Track } from '../../core/types'
import type { ITransport } from '../../services/transport'
import type { TrackMeta } from '../../lib/tauri-ipc'

export class LocalSource implements ISource {
  readonly id = 'local'
  readonly name = 'Local Files'

  constructor(private readonly transport: ITransport) {}

  async init(ctx: ModuleContext): Promise<void> {
    ctx.ui.registerShortcut('ctrl+o', () => this.openFolder(ctx))
    ctx.ui.registerShortcut('ctrl+shift+o', () => this.openFiles(ctx))
  }

  destroy(): void {}

  async resolve(track: Track): Promise<string | null> {
    if (track.source !== 'local') return null
    return convertFileSrc(track.sourceId)
  }

  async search(_query: string): Promise<SearchResult[]> {
    return []
  }

  async scanDirectory(path: string): Promise<Track[]> {
    const metas = await this.transport.call<TrackMeta[]>('scan_directory', { path })
    return metas.map((m) => metaToTrack(m))
  }

  async readMetadata(path: string): Promise<Track> {
    const meta = await this.transport.call<TrackMeta>('read_metadata', { path })
    return metaToTrack(meta)
  }

  private async openFolder(ctx: ModuleContext): Promise<void> {
    const selected = await open({ directory: true, multiple: false, title: 'Select music folder' })
    if (!selected) return
    const path = typeof selected === 'string' ? selected : selected[0]
    if (!path) return
    const tracks = await this.scanDirectory(path)
    if (tracks.length > 0) ctx.player.loadTracks(tracks)
  }

  private async openFiles(ctx: ModuleContext): Promise<void> {
    const selected = await open({
      multiple: true,
      title: 'Select audio files',
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'ogg', 'wav', 'opus', 'm4a', 'aac'] }],
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    const tracks = await Promise.all(paths.map((p) => this.readMetadata(p)))
    if (tracks.length > 0) ctx.player.loadTracks(tracks)
  }
}

function metaToTrack(m: TrackMeta): Track {
  return {
    id: '',
    title: m.title || m.path.split('/').pop() || 'Unknown',
    artist: m.artist || 'Unknown',
    album: m.album ?? undefined,
    duration: m.duration,
    source: 'local',
    sourceId: m.path,
  }
}
