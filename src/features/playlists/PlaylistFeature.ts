import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import type { TrackInput } from '../../services/interfaces'
import { PlaylistService } from '../../services/PlaylistService'
import { EVENTS } from '../../core/events'

export class PlaylistFeature implements IFeature {
  readonly id = 'playlists'

  private svc: PlaylistService
  private cleanups: Array<() => void> = []

  constructor(transport: ITransport) {
    this.svc = new PlaylistService(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    // Restore last session on startup
    await this.restoreSession(ctx).catch(() => {})

    // Save session when app closes
    this.cleanups.push(
      ctx.events.on(EVENTS.APP_CLOSE, async () => {
        await this.saveSession(ctx).catch(() => {})
      }),
    )
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  get service(): PlaylistService {
    return this.svc
  }

  private async saveSession(ctx: ModuleContext): Promise<void> {
    const state = ctx.player.getState()
    if (!state.track) return
    // The session track list is stored via the service
    // Full track list retrieval happens via the renderer — for now we save current track only
    const inputs: TrackInput[] = state.track
      ? [{
          title: state.track.title,
          artist: state.track.artist,
          duration: state.track.duration ?? 0,
          source: state.track.source,
          source_id: state.track.sourceId,
        }]
      : []
    if (inputs.length > 0) await this.svc.saveSession(inputs)
  }

  private async restoreSession(ctx: ModuleContext): Promise<void> {
    const lastPlaylistId = ctx.storage.get<string>('last_playlist_id')
    if (lastPlaylistId) {
      const tracks = await this.svc.getTracks(lastPlaylistId)
      if (tracks.length > 0) {
        ctx.player.loadTracks(
          tracks.map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            duration: t.duration,
            source: t.source,
            sourceId: t.source_id,
            streamUrl: t.source_id.startsWith('http') ? t.source_id : undefined,
          })),
        )
        return
      }
    }

    const session = await this.svc.loadSession()
    if (session.length === 0) return
    ctx.player.loadTracks(
      session.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        source: t.source,
        sourceId: t.source_id,
        streamUrl: t.source_id.startsWith('http') ? t.source_id : undefined,
      })),
    )
  }
}
